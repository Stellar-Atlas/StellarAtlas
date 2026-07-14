import { createGunzip } from 'node:zlib';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { err, ok, type Result } from 'neverthrow';
import { Url, isHttpError, type HttpService } from 'http-helper';
import type { ExceptionLogger } from 'exception-logger';
import { type HistoryArchiveObjectVerificationFactsV1 } from 'shared';
import type { HistoryArchiveWorkerStageDTO } from 'history-scanner-dto';
import { Category } from '../../domain/history-archive/Category.js';
import { hashBucketList } from '../../domain/history-archive/hashBucketList.js';
import { HistoryArchiveStateValidator } from '../../domain/history-archive/HistoryArchiveStateValidator.js';
import type { CategoryVerificationData } from '../../domain/scanner/CategoryScanner.js';
import { CategoryXDRProcessor } from '../../domain/scanner/CategoryXDRProcessor.js';
import { HasherPool } from '../../domain/scanner/HasherPool.js';
import { XdrStreamReader } from '../../domain/scanner/XdrStreamReader.js';
import { CoordinatorParsedHistorySink } from '../../infrastructure/services/CoordinatorParsedHistorySink.js';
import type {
	HistoryArchiveObjectFailureDTO,
	HistoryArchiveObjectJobDTO,
	HistoryArchiveObjectProgressDTO,
	ScanCoordinatorService
} from '../../domain/scan/ScanCoordinatorService.js';
import {
	canonicalJsonContentDigest,
	XdrContentDigestTransform
} from './ArchiveObjectContentDigest.js';
import {
	archiveEvidenceFailure,
	getRetryAfterSecondsFromHttpError,
	scannerIssueFailure
} from './ArchiveObjectFailure.js';
import { classifyCategoryVerificationFailure } from './ArchiveObjectCategoryFailureClassifier.js';

type ProgressReporter = (
	remoteId: string,
	workerStage: HistoryArchiveWorkerStageDTO,
	bytesDownloaded: number | null
) => void;

export class ArchiveObjectCategoryVerifier {
	constructor(
		private readonly httpService: HttpService,
		private readonly scanCoordinator: ScanCoordinatorService,
		private readonly historyArchiveStateValidator: HistoryArchiveStateValidator,
		private readonly exceptionLogger: ExceptionLogger,
		private readonly hasherWorkerCount: number,
		private readonly reportProgress: ProgressReporter
	) {}

	async verifyCheckpointState(
		job: HistoryArchiveObjectJobDTO
	): Promise<
		Result<HistoryArchiveObjectProgressDTO, HistoryArchiveObjectFailureDTO>
	> {
		this.reportProgress(job.remoteId, 'fetching_checkpoint_state', null);
		const urlResult = Url.create(job.objectUrl);
		if (urlResult.isErr()) return err(this.mapLocalError(urlResult.error));

		const response = await this.httpService.get(urlResult.value, {
			responseType: 'json',
			connectionTimeoutMs: 5_000,
			socketTimeoutMs: 10_000
		});
		if (response.isErr()) return err(this.mapHttpError(response.error));

		const state = response.value.data;
		if (!isRecord(state)) {
			return err({
				errorMessage: 'Checkpoint state response must be a JSON object',
				errorType: 'invalid_checkpoint_state',
				failureChannel: 'archive_evidence',
				httpStatus: response.value.status
			});
		}

		const validation = this.historyArchiveStateValidator.validate(state);
		if (validation.isErr()) {
			return err({
				errorMessage: validation.error.message,
				errorType: 'invalid_checkpoint_state',
				failureChannel: 'archive_evidence',
				httpStatus: response.value.status
			});
		}

		const bytesDownloaded = Buffer.byteLength(JSON.stringify(state));
		const bucketListHashResult = hashBucketList(validation.value);
		if (bucketListHashResult.isErr()) {
			return err({
				errorMessage: bucketListHashResult.error.message,
				errorType: 'invalid_checkpoint_state',
				failureChannel: 'archive_evidence',
				httpStatus: response.value.status
			});
		}
		const observedAt = new Date().toISOString();
		if (job.checkpointLedger === null) {
			return err(
				scannerIssueFailure({
					error: new Error(
						'Checkpoint-state job is missing its checkpoint ledger'
					),
					errorType: 'worker_setup_failure'
				})
			);
		}
		if (bucketListHashResult.value.ledger !== job.checkpointLedger) {
			return err(
				archiveEvidenceFailure({
					error: new Error(
						`Checkpoint state declares ledger ${bucketListHashResult.value.ledger}; expected ${job.checkpointLedger}`
					),
					errorType: 'checkpoint_state_ledger_mismatch',
					httpStatus: response.value.status,
					verificationFacts: {
						checkpointHistoryArchiveStateFact: {
							bucketListHash: bucketListHashResult.value.hash,
							checkpointLedger: bucketListHashResult.value.ledger,
							observedAt,
							stellarHistoryUrl: job.objectUrl
						},
						content: canonicalJsonContentDigest(validation.value)
					}
				})
			);
		}

		const checkpointHistoryArchiveState = {
			observedAt,
			stellarHistory: validation.value,
			stellarHistoryUrl: job.objectUrl
		};
		this.reportProgress(
			job.remoteId,
			'verified_checkpoint_state',
			bytesDownloaded
		);
		return ok({
			bytesDownloaded,
			verificationFacts: {
				checkpointHistoryArchiveState,
				checkpointHistoryArchiveStateFact: {
					bucketListHash: bucketListHashResult.value.hash,
					checkpointLedger: bucketListHashResult.value.ledger,
					observedAt,
					stellarHistoryUrl: job.objectUrl
				},
				content: canonicalJsonContentDigest(validation.value)
			},
			workerStage: 'verified'
		});
	}

	async verifyCategoryObject(
		job: HistoryArchiveObjectJobDTO
	): Promise<
		Result<HistoryArchiveObjectProgressDTO, HistoryArchiveObjectFailureDTO>
	> {
		const category = getCategory(job.objectType);
		const workerStages = getCategoryWorkerStages(job.objectType);
		if (category === null || workerStages === null) {
			return err({
				errorMessage: `Unsupported category object type: ${job.objectType}`,
				errorType: 'unsupported_object_type',
				failureChannel: 'scanner_issue',
				httpStatus: null
			});
		}

		this.reportProgress(job.remoteId, workerStages.fetching, 0);
		const urlResult = Url.create(job.objectUrl);
		if (urlResult.isErr()) return err(this.mapLocalError(urlResult.error));

		const response = await this.httpService.get(urlResult.value, {
			responseType: 'stream',
			connectionTimeoutMs: 10_000,
			socketTimeoutMs: 60_000
		});
		if (response.isErr()) return err(this.mapHttpError(response.error));
		if (!isReadable(response.value.data)) {
			return err({
				errorMessage: `${job.objectType} response must be a readable stream`,
				errorType: 'invalid_category_response',
				failureChannel: 'scanner_issue',
				httpStatus: response.value.status
			});
		}

		let bytesDownloaded = 0;
		const byteCounter = new ByteCounter((bytes) => {
			bytesDownloaded += bytes;
			this.reportProgress(
				job.remoteId,
				workerStages.downloading,
				bytesDownloaded
			);
		});
		let pool: HasherPool;
		try {
			pool = new HasherPool(Math.max(Math.floor(this.hasherWorkerCount), 1));
		} catch (error) {
			return err(
				scannerIssueFailure({ error, errorType: 'worker_pool_setup_failure' })
			);
		}
		const parsedHistorySink = shouldPersistParsedHistory(category)
			? new CoordinatorParsedHistorySink(
					this.scanCoordinator,
					job.archiveUrl,
					job.remoteId,
					this.exceptionLogger
				)
			: undefined;

		const categoryVerificationData = createCategoryVerificationData();
		const contentDigest = new XdrContentDigestTransform();
		let verificationResult: Result<
			HistoryArchiveObjectProgressDTO,
			HistoryArchiveObjectFailureDTO
		>;
		try {
			const processor = new CategoryXDRProcessor(
				pool,
				urlResult.value,
				category,
				categoryVerificationData,
				parsedHistorySink
			);
			await pipeline([
				response.value.data,
				byteCounter,
				createGunzip(),
				contentDigest,
				new XdrStreamReader(),
				processor
			]);
			const processedEntries = processor.processedEntries;
			await parsedHistorySink?.flush();
			this.reportProgress(job.remoteId, workerStages.verified, bytesDownloaded);
			verificationResult = ok({
				bytesDownloaded,
				verificationFacts: {
					...createCategoryVerificationFacts(
						job.objectType,
						categoryVerificationData,
						processedEntries,
						job.objectUrl
					),
					content: contentDigest.toFact()
				},
				workerStage: 'verified'
			});
		} catch (error) {
			verificationResult = err(
				classifyCategoryVerificationFailure(error, response.value.status)
			);
		}
		try {
			await pool.workerpool.terminate(true);
		} catch (error) {
			return err(
				scannerIssueFailure({
					error,
					errorType: 'worker_pool_termination_failure'
				})
			);
		} finally {
			pool.terminated = true;
		}
		return verificationResult;
	}

	private mapHttpError(error: unknown): HistoryArchiveObjectFailureDTO {
		if (isHttpError(error)) {
			return archiveEvidenceFailure({
				error,
				errorType: error.response
					? 'archive_http_error'
					: 'archive_transport_error',
				httpStatus: error.response?.status ?? null,
				retryAfterSeconds: getRetryAfterSecondsFromHttpError(error)
			});
		}

		return scannerIssueFailure({ error, errorType: 'http_client_failure' });
	}

	private mapLocalError(error: unknown): HistoryArchiveObjectFailureDTO {
		return scannerIssueFailure({ error, errorType: 'worker_setup_failure' });
	}
}

class ByteCounter extends Transform {
	constructor(onBytes: (bytes: number) => void) {
		super({
			transform(chunk: Buffer, _encoding, callback) {
				onBytes(chunk.length);
				callback(null, chunk);
			}
		});
	}
}

function getCategory(objectType: string): Category | null {
	switch (objectType) {
		case 'ledger':
			return Category.ledger;
		case 'transactions':
			return Category.transactions;
		case 'results':
			return Category.results;
		case 'scp':
			return Category.scp;
		default:
			return null;
	}
}

function getCategoryWorkerStages(
	objectType: HistoryArchiveObjectJobDTO['objectType']
): {
	readonly downloading: HistoryArchiveWorkerStageDTO;
	readonly fetching: HistoryArchiveWorkerStageDTO;
	readonly verified: HistoryArchiveWorkerStageDTO;
} | null {
	switch (objectType) {
		case 'ledger':
			return {
				downloading: 'downloading_ledger',
				fetching: 'fetching_ledger',
				verified: 'verified_ledger'
			};
		case 'transactions':
			return {
				downloading: 'downloading_transactions',
				fetching: 'fetching_transactions',
				verified: 'verified_transactions'
			};
		case 'results':
			return {
				downloading: 'downloading_results',
				fetching: 'fetching_results',
				verified: 'verified_results'
			};
		case 'scp':
			return {
				downloading: 'downloading_scp',
				fetching: 'fetching_scp',
				verified: 'verified_scp'
			};
		default:
			return null;
	}
}

function shouldPersistParsedHistory(category: Category): boolean {
	return (
		category === Category.ledger ||
		category === Category.transactions ||
		category === Category.results
	);
}

function createCategoryVerificationData(): CategoryVerificationData {
	return {
		calculatedLedgerHeaderHashes: new Map(),
		calculatedTxSetHashes: new Map(),
		calculatedTxSetResultHashes: new Map(),
		expectedHashesPerLedger: new Map(),
		protocolVersions: new Map()
	};
}

function createCategoryVerificationFacts(
	objectType: string,
	data: CategoryVerificationData,
	entryCount: number,
	sourceUrl: string
): HistoryArchiveObjectVerificationFactsV1 {
	if (objectType === 'ledger') {
		return {
			ledgerCategory: {
				entryCount,
				ledgers: Array.from(data.expectedHashesPerLedger.entries())
					.map(([ledger, expectedHashes]) => ({
						bucketListHash: expectedHashes.bucketListHash,
						ledger,
						ledgerHeaderHash:
							data.calculatedLedgerHeaderHashes.get(ledger) ?? null,
						previousLedgerHeaderHash: expectedHashes.previousLedgerHeaderHash,
						protocolVersion: data.protocolVersions.get(ledger) ?? null,
						transactionResultSetHash: expectedHashes.txSetResultHash,
						transactionSetHash: expectedHashes.txSetHash
					}))
					.sort((left, right) => left.ledger - right.ledger),
				sourceUrl
			}
		};
	}

	if (objectType === 'transactions') {
		return {
			transactionsCategory: {
				entryCount,
				ledgers: mapHashFacts(data.calculatedTxSetHashes),
				sourceUrl
			}
		};
	}

	if (objectType === 'results') {
		return {
			resultsCategory: {
				entryCount,
				ledgers: mapHashFacts(data.calculatedTxSetResultHashes),
				sourceUrl
			}
		};
	}

	return { scpCategory: { entryCount, sourceUrl } };
}

function mapHashFacts(
	hashes: ReadonlyMap<number, string>
): readonly { readonly hash: string; readonly ledger: number }[] {
	return Array.from(hashes.entries())
		.map(([ledger, hash]) => ({ hash, ledger }))
		.sort((left, right) => left.ledger - right.ledger);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReadable(value: unknown): value is Readable {
	return (
		typeof value === 'object' &&
		value !== null &&
		'pipe' in value &&
		typeof value.pipe === 'function'
	);
}
