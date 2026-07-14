import { createHash } from 'node:crypto';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { inject, injectable } from 'inversify';
import { err, ok, type Result } from 'neverthrow';
import { Url, isHttpError, type HttpService } from 'http-helper';
import type { ExceptionLogger } from 'exception-logger';
import type { JobMonitor } from 'job-monitor';
import type { Logger } from 'logger';
import { asyncSleep, mapUnknownToError } from 'shared';
import type { HistoryArchiveWorkerOutcomeDTO } from 'history-scanner-dto';
import { HistoryArchiveStateValidator } from '../../domain/history-archive/HistoryArchiveStateValidator.js';
import { BucketCache } from '../../domain/scanner/BucketCache.js';
import type {
	HistoryArchiveObjectCompletionDTO,
	HistoryArchiveObjectFailureDTO,
	HistoryArchiveObjectJobDTO,
	HistoryArchiveObjectProgressDTO,
	ScanCoordinatorService
} from '../../domain/scan/ScanCoordinatorService.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import type { HistoryArchiveWorkerStatusReporter } from '../../domain/scan/HistoryArchiveWorkerStatusReporter.js';
import { ArchiveObjectCategoryVerifier } from './ArchiveObjectCategoryVerifier.js';
import {
	ArchiveObjectWorkerTelemetry,
	mapFailureToWorkerOutcome
} from './ArchiveObjectWorkerTelemetry.js';
import { CoalescingHistoryArchiveWorkerReporter } from './CoalescingHistoryArchiveWorkerReporter.js';
import type { VerifyArchiveObjectsDTO } from './VerifyArchiveObjectsDTO.js';
import { canonicalJsonContentDigest } from './ArchiveObjectContentDigest.js';
import {
	archiveEvidenceFailure,
	getRetryAfterSecondsFromHttpError,
	scannerIssueFailure
} from './ArchiveObjectFailure.js';

const maximumPendingWorkerReports = 24;

@injectable()
export class VerifyArchiveObjects {
	private readonly categoryVerifier: ArchiveObjectCategoryVerifier;
	private readonly workerTelemetry: ArchiveObjectWorkerTelemetry;

	constructor(
		@inject(TYPES.ScanCoordinatorService)
		private readonly scanCoordinator: ScanCoordinatorService,
		@inject(TYPES.HistoryArchiveWorkerStatusReporter)
		workerStatusReporter: HistoryArchiveWorkerStatusReporter,
		@inject(TYPES.HttpService)
		private readonly httpService: HttpService,
		private readonly historyArchiveStateValidator: HistoryArchiveStateValidator,
		private readonly bucketCache: BucketCache,
		@inject(TYPES.ExceptionLogger)
		private readonly exceptionLogger: ExceptionLogger,
		@inject(TYPES.JobMonitor)
		private readonly jobMonitor: JobMonitor,
		@inject(TYPES.ScanWorkerCount)
		private readonly workerCount: number,
		@inject(TYPES.HasherWorkerCount)
		private readonly hasherWorkerCount: number,
		@inject('Logger')
		private readonly logger: Logger
	) {
		const coalescingStatusReporter = new CoalescingHistoryArchiveWorkerReporter(
			workerStatusReporter,
			this.exceptionLogger,
			maximumPendingWorkerReports
		);
		this.workerTelemetry = new ArchiveObjectWorkerTelemetry(
			this.scanCoordinator,
			coalescingStatusReporter,
			this.exceptionLogger,
			this.logger
		);
		this.categoryVerifier = new ArchiveObjectCategoryVerifier(
			this.httpService,
			this.scanCoordinator,
			this.historyArchiveStateValidator,
			this.exceptionLogger,
			this.hasherWorkerCount,
			(remoteId, workerStage, bytesDownloaded) =>
				this.workerTelemetry.updateProgress(
					remoteId,
					workerStage,
					bytesDownloaded
				)
		);
	}

	async execute(dto: VerifyArchiveObjectsDTO): Promise<void> {
		const workerCount = Math.max(Math.floor(this.workerCount), 1);
		await Promise.all(
			Array.from({ length: workerCount }, (_, slot) =>
				this.runWorkerLoop(dto, slot)
			)
		);
	}

	async releaseActiveObjectJobs(): Promise<void> {
		await this.workerTelemetry.releaseActiveObjectJobs();
	}

	private async runWorkerLoop(
		dto: VerifyArchiveObjectsDTO,
		slot: number
	): Promise<void> {
		this.workerTelemetry.reportIdle(slot);
		do {
			try {
				await this.claimAndVerifyObject(slot);
			} catch (error) {
				this.exceptionLogger.captureException(mapUnknownToError(error));
				await this.waitBeforeRetry();
			}
		} while (dto.loop);
	}

	private async claimAndVerifyObject(slot: number): Promise<void> {
		const jobResult = await this.scanCoordinator.getHistoryArchiveObjectJob();
		if (jobResult.isErr()) {
			this.exceptionLogger.captureException(jobResult.error);
			await this.waitBeforeRetry();
			return;
		}

		if (jobResult.value === null) {
			this.workerTelemetry.reportIdle(slot);
			await this.waitBeforeRetry();
			return;
		}

		await this.verifyObject(jobResult.value, slot);
	}

	private async verifyObject(
		job: HistoryArchiveObjectJobDTO,
		slot = 0
	): Promise<void> {
		this.workerTelemetry.startObject(slot, job);
		await this.checkIn('in_progress');
		let outcome: HistoryArchiveWorkerOutcomeDTO = 'worker_issue';

		try {
			const result = await this.performObjectVerification(job);
			if (result.isErr()) {
				const failResult = await this.failObject(job, result.error);
				if (failResult.isErr()) {
					await this.checkIn('error');
					throw failResult.error;
				}
				outcome = mapFailureToWorkerOutcome(result.error);
				await this.checkIn('error');
				return;
			}

			const completionResult =
				await this.scanCoordinator.completeHistoryArchiveObject(job.remoteId, {
					...result.value,
					claimAttempt: job.claimAttempt
				});
			if (completionResult.isErr()) {
				this.exceptionLogger.captureException(completionResult.error);
				await this.checkIn('error');
				throw completionResult.error;
			}
			outcome = 'verified';
			await this.checkIn('ok');
		} finally {
			await this.workerTelemetry.finishObject(job.remoteId, outcome);
		}
	}

	private async performObjectVerification(
		job: HistoryArchiveObjectJobDTO
	): Promise<
		Result<HistoryArchiveObjectCompletionDTO, HistoryArchiveObjectFailureDTO>
	> {
		switch (job.objectType) {
			case 'history-archive-state':
				return this.verifyHistoryArchiveState(job);
			case 'checkpoint-state':
				return this.categoryVerifier.verifyCheckpointState(job);
			case 'ledger':
			case 'transactions':
			case 'results':
			case 'scp':
				return this.categoryVerifier.verifyCategoryObject(job);
			case 'bucket':
				return this.verifyBucket(job);
			default:
				return err({
					errorMessage: `Unsupported history archive object type: ${job.objectType}`,
					errorType: 'unsupported_object_type',
					failureChannel: 'scanner_issue',
					httpStatus: null
				});
		}
	}

	private async verifyHistoryArchiveState(
		job: HistoryArchiveObjectJobDTO
	): Promise<
		Result<HistoryArchiveObjectCompletionDTO, HistoryArchiveObjectFailureDTO>
	> {
		this.workerTelemetry.updateProgress(
			job.remoteId,
			'fetching_history_archive_state',
			null
		);
		const urlResult = Url.create(job.objectUrl);
		if (urlResult.isErr()) return err(this.mapLocalError(urlResult.error));

		const response = await this.httpService.get(urlResult.value, {
			responseType: 'json',
			connectionTimeoutMs: 5_000,
			socketTimeoutMs: 10_000
		});
		if (response.isErr()) return err(this.mapHttpError(response.error));

		const state = response.value.data;
		if (!this.isRecord(state)) {
			return err({
				errorMessage: 'History archive state response must be a JSON object',
				errorType: 'invalid_history_archive_state',
				failureChannel: 'archive_evidence',
				httpStatus: response.value.status
			});
		}

		const validation = this.historyArchiveStateValidator.validate(state);
		if (validation.isErr()) {
			return err({
				errorMessage: validation.error.message,
				errorType: 'invalid_history_archive_state',
				failureChannel: 'archive_evidence',
				httpStatus: response.value.status
			});
		}

		const bytesDownloaded = Buffer.byteLength(JSON.stringify(state));
		this.workerTelemetry.updateProgress(
			job.remoteId,
			'verified_history_archive_state',
			bytesDownloaded
		);
		return ok({
			archiveMetadata: {
				observedAt: new Date().toISOString(),
				stellarHistory: validation.value,
				stellarHistoryUrl: job.objectUrl
			},
			bytesDownloaded,
			verificationFacts: {
				content: canonicalJsonContentDigest(validation.value)
			},
			workerStage: 'verified'
		});
	}

	private async verifyBucket(
		job: HistoryArchiveObjectJobDTO
	): Promise<
		Result<HistoryArchiveObjectProgressDTO, HistoryArchiveObjectFailureDTO>
	> {
		if (job.bucketHash === null || !/^[a-fA-F0-9]{64}$/.test(job.bucketHash)) {
			return err({
				errorMessage: 'Bucket object is missing a valid bucket hash',
				errorType: 'invalid_bucket_object',
				failureChannel: 'scanner_issue',
				httpStatus: null
			});
		}

		this.workerTelemetry.updateProgress(job.remoteId, 'fetching_bucket', 0);
		const urlResult = Url.create(job.objectUrl);
		if (urlResult.isErr()) return err(this.mapLocalError(urlResult.error));

		const response = await this.httpService.get(urlResult.value, {
			responseType: 'stream',
			connectionTimeoutMs: 10_000,
			socketTimeoutMs: 60_000
		});
		if (response.isErr()) return err(this.mapHttpError(response.error));
		if (!this.isReadable(response.value.data)) {
			return err({
				errorMessage: 'Bucket response must be a readable stream',
				errorType: 'invalid_bucket_response',
				failureChannel: 'scanner_issue',
				httpStatus: response.value.status
			});
		}

		let bytesDownloaded = 0;
		const countedStream = this.createCountingStream(
			response.value.data,
			(bytes) => {
				bytesDownloaded += bytes;
				this.workerTelemetry.updateProgress(
					job.remoteId,
					'downloading_bucket',
					bytesDownloaded
				);
			}
		);
		const verifyResult = await this.bucketCache.verifyAndStore(
			job.bucketHash.toLowerCase(),
			countedStream,
			(streamToVerify) => this.verifyBucketHash(streamToVerify, job.bucketHash!)
		);
		if (verifyResult.isErr()) {
			if (verifyResult.error.kind === 'source-stream') {
				return err(
					archiveEvidenceFailure({
						error: verifyResult.error,
						errorType: 'archive_transport_error',
						httpStatus: response.value.status
					})
				);
			}
			return err(
				verifyResult.error.kind === 'content-verification'
					? archiveEvidenceFailure({
							error: verifyResult.error,
							errorType: 'bucket_verification_failed',
							httpStatus: response.value.status
						})
					: scannerIssueFailure({
							error: verifyResult.error,
							errorType: 'bucket_cache_failure',
							httpStatus: null
						})
			);
		}

		this.workerTelemetry.updateProgress(
			job.remoteId,
			'verified_bucket',
			bytesDownloaded
		);
		return ok({
			bytesDownloaded,
			verificationFacts: {
				bucketObject: {
					expectedBucketHash: job.bucketHash.toLowerCase(),
					hashAlgorithm: 'sha256',
					matched: true,
					sourceUrl: job.objectUrl
				},
				content: {
					algorithm: 'sha256',
					digest: job.bucketHash.toLowerCase(),
					representation: 'uncompressed-xdr'
				}
			},
			workerStage: 'verified'
		});
	}

	private async verifyBucketHash(
		readStream: Readable,
		expectedHash: string
	): Promise<Result<void, Error>> {
		const zlib = createGunzip();
		const hasher = createHash('sha256');

		try {
			await pipeline(readStream, zlib, hasher);
			const digest = hasher.digest('hex');
			if (digest === expectedHash.toLowerCase()) return ok(undefined);
			return err(new Error('Wrong bucket hash'));
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}

	private createCountingStream(
		source: Readable,
		onBytes: (bytes: number) => void
	): Readable {
		const counter = new Transform({
			transform(chunk: Buffer, _encoding, callback) {
				onBytes(chunk.length);
				callback(null, chunk);
			}
		});
		source.on('error', (error) => counter.destroy(error));
		return source.pipe(counter);
	}

	private async failObject(
		job: HistoryArchiveObjectJobDTO,
		failure: HistoryArchiveObjectFailureDTO
	): Promise<Result<void, Error>> {
		const result = await this.scanCoordinator.failHistoryArchiveObject(
			job.remoteId,
			{ ...failure, claimAttempt: job.claimAttempt }
		);
		if (result.isErr()) this.exceptionLogger.captureException(result.error);
		this.logger.warn('History archive object failed verification', {
			errorMessage: failure.errorMessage,
			errorType: failure.errorType,
			httpStatus: failure.httpStatus ?? null,
			remoteId: job.remoteId
		});
		return result;
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

	private async checkIn(status: 'in_progress' | 'error' | 'ok') {
		const result = await this.jobMonitor.checkIn({
			context: 'verify-archive-objects',
			status
		});

		if (result.isErr()) {
			this.exceptionLogger.captureException(result.error);
		}
	}

	private async waitBeforeRetry(): Promise<void> {
		const jitterMs = Math.floor(Math.random() * 2_500);
		await asyncSleep(10_000 + jitterMs);
	}

	private isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
	}

	private isReadable(value: unknown): value is Readable {
		return (
			typeof value === 'object' &&
			value !== null &&
			'pipe' in value &&
			typeof value.pipe === 'function'
		);
	}
}
