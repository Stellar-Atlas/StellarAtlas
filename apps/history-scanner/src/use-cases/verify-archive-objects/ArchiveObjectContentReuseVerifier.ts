import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import type { ExceptionLogger } from 'exception-logger';
import { Url, type HttpService } from 'http-helper';
import { err, ok, type Result } from 'neverthrow';
import {
	historyArchiveContentDerivationVersionV1,
	type HistoryArchiveObjectVerificationFactsV1,
	type HistoryArchiveReusableContentV1
} from 'shared';
import type { HistoryArchiveWorkerStageDTO } from 'history-scanner-dto';
import type {
	HistoryArchiveObjectFailureDTO,
	HistoryArchiveObjectJobDTO,
	HistoryArchiveObjectProgressDTO,
	ScanCoordinatorService
} from '../../domain/scan/ScanCoordinatorService.js';
import type { HistoryArchiveDownloadPermit } from '../../infrastructure/services/HistoryArchiveDownloadPermit.js';
import { classifyCategoryVerificationFailure } from './ArchiveObjectCategoryFailureClassifier.js';
import { getCategoryWorkerStages } from './ArchiveObjectCategoryWorkerStages.js';
import { XdrContentDigestTransform } from './ArchiveObjectContentDigest.js';
import { createArchiveObjectDownloadCounter } from './ArchiveObjectDownloadCounter.js';
import { readArchiveObjectContentLength } from './ArchiveObjectHttpContentLength.js';
import {
	isReadableArchiveObject,
	mapArchiveObjectHttpError,
	mapArchiveObjectLocalError
} from './ArchiveObjectWorkerHelpers.js';

type ProgressReporter = (
	remoteId: string,
	workerStage: HistoryArchiveWorkerStageDTO,
	bytesDownloaded: number | null,
	bytesTotal: number | null
) => void;

type ProgressFlusher = (
	remoteId: string,
	workerStage: HistoryArchiveWorkerStageDTO,
	bytesDownloaded: number | null,
	bytesTotal: number | null
) => Promise<void>;

export class ArchiveObjectContentReuseVerifier {
	constructor(
		private readonly httpService: HttpService,
		private readonly scanCoordinator: ScanCoordinatorService,
		private readonly exceptionLogger: ExceptionLogger,
		private readonly reportProgress: ProgressReporter,
		private readonly flushProgress: ProgressFlusher,
		private readonly downloadPermit: HistoryArchiveDownloadPermit
	) {}

	async tryReuse(
		job: HistoryArchiveObjectJobDTO,
		executionId: string,
		releaseDownloadPermit?: () => void
	): Promise<
		Result<
			HistoryArchiveObjectProgressDTO | null,
			HistoryArchiveObjectFailureDTO
		>
	> {
		const workerStages = getCategoryWorkerStages(job.objectType);
		if (workerStages === null) return ok(null);
		const urlResult = Url.create(job.objectUrl);
		if (urlResult.isErr())
			return err(mapArchiveObjectLocalError(urlResult.error));

		releaseDownloadPermit ??= await this.downloadPermit.acquire();
		this.reportProgress(job.remoteId, workerStages.fetching, 0, null);
		const response = await this.httpService.get(urlResult.value, {
			connectionTimeoutMs: 10_000,
			responseType: 'stream',
			socketTimeoutMs: 60_000
		});
		if (response.isErr()) {
			releaseDownloadPermit();
			return err(mapArchiveObjectHttpError(response.error));
		}
		if (!isReadableArchiveObject(response.value.data)) {
			releaseDownloadPermit();
			return err({
				errorMessage: `${job.objectType} response must be a readable stream`,
				errorType: 'invalid_category_response',
				failureChannel: 'scanner_issue',
				httpStatus: response.value.status
			});
		}

		const bytesTotal = readArchiveObjectContentLength(response.value.headers);
		let bytesDownloaded = 0;
		let activeWorkerStage = workerStages.downloading;
		this.reportProgress(job.remoteId, activeWorkerStage, 0, bytesTotal);
		const byteCounter = createArchiveObjectDownloadCounter(
			(bytes) => {
				bytesDownloaded += bytes;
				this.reportProgress(
					job.remoteId,
					activeWorkerStage,
					bytesDownloaded,
					bytesTotal
				);
			},
			async () => {
				activeWorkerStage = workerStages.processing;
				await this.flushProgress(
					job.remoteId,
					activeWorkerStage,
					bytesDownloaded,
					bytesTotal
				);
				releaseDownloadPermit!();
			}
		);
		const contentDigest = new XdrContentDigestTransform();
		try {
			await pipeline([
				response.value.data,
				byteCounter,
				createGunzip(),
				contentDigest,
				new Writable({
					write(_chunk, _encoding, callback) {
						callback();
					}
				})
			]);
		} catch (error) {
			return err(
				classifyCategoryVerificationFailure(error, response.value.status)
			);
		} finally {
			releaseDownloadPermit();
		}

		const digestFact = contentDigest.toFact();
		const lookup = await this.scanCoordinator.getHistoryArchiveContentReuse({
			claimAttempt: job.claimAttempt,
			contentDigest: digestFact.digest,
			contentRepresentation: 'uncompressed-xdr',
			derivationVersion: historyArchiveContentDerivationVersionV1,
			executionId,
			objectKey: job.objectKey,
			objectType: job.objectType,
			remoteId: job.remoteId
		});
		if (lookup.isErr()) {
			this.exceptionLogger.captureException(lookup.error);
			return ok(null);
		}
		if (lookup.value === null) return ok(null);
		const reusable = lookup.value;
		if (!isExactReusableContent(job, digestFact.digest, reusable)) {
			this.exceptionLogger.captureException(
				new Error('Coordinator returned mismatched reusable archive content')
			);
			return ok(null);
		}
		this.reportProgress(
			job.remoteId,
			workerStages.verified,
			bytesDownloaded,
			bytesTotal
		);
		return ok({
			bytesDownloaded,
			contentReuse: {
				artifactId: reusable.artifactId,
				contentDigest: reusable.contentDigest,
				contentRepresentation: reusable.contentRepresentation,
				derivationVersion: reusable.derivationVersion,
				sourceObjectRemoteId: reusable.sourceObjectRemoteId
			},
			verificationFacts: reusable.verificationFacts,
			workerStage: 'verified'
		});
	}
}

function isExactReusableContent(
	job: HistoryArchiveObjectJobDTO,
	digest: string,
	reusable: HistoryArchiveReusableContentV1
): boolean {
	if (
		reusable.contentDigest !== digest ||
		reusable.contentRepresentation !== 'uncompressed-xdr' ||
		reusable.derivationVersion !== historyArchiveContentDerivationVersionV1
	) {
		return false;
	}
	const facts = reusable.verificationFacts;
	if (
		facts.content?.algorithm !== 'sha256' ||
		facts.content.digest !== digest ||
		facts.content.representation !== 'uncompressed-xdr'
	) {
		return false;
	}
	const category = categoryFacts(job.objectType, facts);
	if (
		category === null ||
		category.sourceUrl !== job.objectUrl ||
		typeof category.entryCount !== 'number' ||
		!Number.isSafeInteger(category.entryCount) ||
		category.entryCount < 0
	) {
		return false;
	}
	if (job.objectType === 'scp') return true;
	return (
		Array.isArray(category.ledgers) &&
		category.ledgers.length === category.entryCount
	);
}

function categoryFacts(
	objectType: HistoryArchiveObjectJobDTO['objectType'],
	facts: HistoryArchiveObjectVerificationFactsV1
): Record<string, unknown> | null {
	let value: unknown;
	switch (objectType) {
		case 'ledger':
			value = facts.ledgerCategory;
			break;
		case 'transactions':
			value = facts.transactionsCategory;
			break;
		case 'results':
			value = facts.resultsCategory;
			break;
		case 'scp':
			value = facts.scpCategory;
			break;
		default:
			return null;
	}
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as unknown as Record<string, unknown>)
		: null;
}
