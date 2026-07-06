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
import { ArchiveObjectCategoryVerifier } from './ArchiveObjectCategoryVerifier.js';
import type { VerifyArchiveObjectsDTO } from './VerifyArchiveObjectsDTO.js';

interface ActiveObjectProgress {
	bytesDownloaded: number | null;
	claimAttempt: number;
	workerStage: string;
}

@injectable()
export class VerifyArchiveObjects {
	private static readonly initialHeartbeatDelayMs = 10 * 1000;
	private static readonly heartbeatIntervalMs = 45 * 1000;
	private static readonly heartbeatJitterMs = 20 * 1000;
	private readonly activeObjectProgress = new Map<string, ActiveObjectProgress>();
	private readonly activeObjectHeartbeatsInFlight = new Set<string>();
	private readonly categoryVerifier: ArchiveObjectCategoryVerifier;

	constructor(
		@inject(TYPES.ScanCoordinatorService)
		private readonly scanCoordinator: ScanCoordinatorService,
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
		this.categoryVerifier = new ArchiveObjectCategoryVerifier(
			this.httpService,
			this.scanCoordinator,
			this.historyArchiveStateValidator,
			this.exceptionLogger,
			this.hasherWorkerCount,
			(remoteId, workerStage, bytesDownloaded) =>
				this.updateProgress(remoteId, workerStage, bytesDownloaded)
		);
	}

	async execute(dto: VerifyArchiveObjectsDTO): Promise<void> {
		const workerCount = Math.max(Math.floor(this.workerCount), 1);
		await Promise.all(
			Array.from({ length: workerCount }, () => this.runWorkerLoop(dto))
		);
	}

	async releaseActiveObjectJobs(): Promise<void> {
		const results = await Promise.all(
			Array.from(this.activeObjectProgress.entries(), ([remoteId, progress]) =>
				this.scanCoordinator
					.releaseHistoryArchiveObject(remoteId, progress.claimAttempt)
					.then((result) => ({ remoteId, result }))
			)
		);

		for (const { remoteId, result } of results) {
			if (result.isOk()) continue;
			this.exceptionLogger.captureException(result.error);
			this.logger.warn('Failed to release active history archive object job', {
				remoteId
			});
		}
	}

	private async runWorkerLoop(dto: VerifyArchiveObjectsDTO): Promise<void> {
		do {
			try {
				await this.claimAndVerifyObject();
			} catch (error) {
				this.exceptionLogger.captureException(mapUnknownToError(error));
				await this.waitBeforeRetry();
			}
		} while (dto.loop);
	}

	private async claimAndVerifyObject(): Promise<void> {
		const jobResult = await this.scanCoordinator.getHistoryArchiveObjectJob();
		if (jobResult.isErr()) {
			this.exceptionLogger.captureException(jobResult.error);
			await this.waitBeforeRetry();
			return;
		}

		if (jobResult.value === null) {
			await this.waitBeforeRetry();
			return;
		}

		await this.verifyObject(jobResult.value);
	}

	private async verifyObject(job: HistoryArchiveObjectJobDTO): Promise<void> {
		this.activeObjectProgress.set(job.remoteId, {
			bytesDownloaded: null,
			claimAttempt: job.claimAttempt,
			workerStage: 'claimed'
		});
		await this.checkIn('in_progress');
		const stopHeartbeat = this.startHeartbeat(job.remoteId);

		try {
			const result = await this.performObjectVerification(job);
			if (result.isErr()) {
				const failResult = await this.failObject(job, result.error);
				if (failResult.isErr()) {
					await this.checkIn('error');
					throw failResult.error;
				}
				await this.checkIn('error');
				return;
			}

			const completionResult = await this.scanCoordinator.completeHistoryArchiveObject(
				job.remoteId,
				{ ...result.value, claimAttempt: job.claimAttempt }
			);
			if (completionResult.isErr()) {
				this.exceptionLogger.captureException(completionResult.error);
				await this.checkIn('error');
				throw completionResult.error;
			}
			await this.checkIn('ok');
		} finally {
			stopHeartbeat();
			this.activeObjectProgress.delete(job.remoteId);
		}
	}

	private async performObjectVerification(
		job: HistoryArchiveObjectJobDTO
	): Promise<Result<HistoryArchiveObjectCompletionDTO, HistoryArchiveObjectFailureDTO>> {
		switch (job.objectType) {
			case 'history-archive-state':
				return this.verifyHistoryArchiveState(job);
			case 'checkpoint-state':
				return this.categoryVerifier.verifyCheckpointState(job);
			case 'ledger':
			case 'transactions':
			case 'results':
				return this.categoryVerifier.verifyCategoryObject(job);
			case 'bucket':
				return this.verifyBucket(job);
			default:
				return err({
					errorMessage: `Unsupported history archive object type: ${job.objectType}`,
					errorType: 'unsupported_object_type',
					httpStatus: null
				});
		}
	}

	private async verifyHistoryArchiveState(
		job: HistoryArchiveObjectJobDTO
	): Promise<Result<HistoryArchiveObjectCompletionDTO, HistoryArchiveObjectFailureDTO>> {
		this.updateProgress(job.remoteId, 'fetching_history_archive_state', null);
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
				httpStatus: response.value.status
			});
		}

		const validation = this.historyArchiveStateValidator.validate(state);
		if (validation.isErr()) {
			return err({
				errorMessage: validation.error.message,
				errorType: 'invalid_history_archive_state',
				httpStatus: response.value.status
			});
		}

		const bytesDownloaded = Buffer.byteLength(JSON.stringify(state));
		this.updateProgress(job.remoteId, 'verified_history_archive_state', bytesDownloaded);
		return ok({
			archiveMetadata: {
				observedAt: new Date().toISOString(),
				stellarHistory: validation.value,
				stellarHistoryUrl: job.objectUrl
			},
			bytesDownloaded,
			workerStage: 'verified'
		});
	}

	private async verifyBucket(
		job: HistoryArchiveObjectJobDTO
	): Promise<Result<HistoryArchiveObjectProgressDTO, HistoryArchiveObjectFailureDTO>> {
		if (job.bucketHash === null || !/^[a-fA-F0-9]{64}$/.test(job.bucketHash)) {
			return err({
				errorMessage: 'Bucket object is missing a valid bucket hash',
				errorType: 'invalid_bucket_object',
				httpStatus: null
			});
		}

		this.updateProgress(job.remoteId, 'fetching_bucket', 0);
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
				httpStatus: response.value.status
			});
		}

		let bytesDownloaded = 0;
		const countedStream = this.createCountingStream(
			response.value.data,
			(bytes) => {
				bytesDownloaded += bytes;
				this.updateProgress(job.remoteId, 'downloading_bucket', bytesDownloaded);
			}
		);
		const verifyResult = await this.bucketCache.verifyAndStore(
			job.bucketHash.toLowerCase(),
			countedStream,
			(streamToVerify) => this.verifyBucketHash(streamToVerify, job.bucketHash!)
		);
		if (verifyResult.isErr()) {
			return err({
				errorMessage: verifyResult.error.message,
				errorType: 'bucket_verification_failed',
				httpStatus: response.value.status
			});
		}

		this.updateProgress(job.remoteId, 'verified_bucket', bytesDownloaded);
		return ok({
			bytesDownloaded,
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

	private updateProgress(
		remoteId: string,
		workerStage: string,
		bytesDownloaded: number | null
	): void {
		const existing = this.activeObjectProgress.get(remoteId);
		if (existing === undefined) return;

		this.activeObjectProgress.set(remoteId, {
			bytesDownloaded,
			claimAttempt: existing.claimAttempt,
			workerStage
		});
	}

	private startHeartbeat(remoteId: string): () => void {
		let stopped = false;
		let timeout: ReturnType<typeof setTimeout> | null = null;
		const schedule = (delayMs: number) => {
			timeout = setTimeout(() => {
				if (stopped) return;
				void this.touchObject(remoteId).finally(() => {
					if (!stopped) {
						schedule(VerifyArchiveObjects.heartbeatIntervalMs);
					}
				});
			}, delayMs);
		};
		schedule(
			VerifyArchiveObjects.initialHeartbeatDelayMs +
				Math.floor(Math.random() * VerifyArchiveObjects.heartbeatJitterMs)
		);

		return () => {
			stopped = true;
			if (timeout !== null) clearTimeout(timeout);
		};
	}

	private async touchObject(remoteId: string): Promise<void> {
		if (this.activeObjectHeartbeatsInFlight.has(remoteId)) return;
		const progress = this.activeObjectProgress.get(remoteId);
		this.activeObjectHeartbeatsInFlight.add(remoteId);
		try {
			const result = await this.scanCoordinator.touchHistoryArchiveObject(
				remoteId,
				progress === undefined
					? undefined
					: {
							bytesDownloaded: progress.bytesDownloaded,
							claimAttempt: progress.claimAttempt,
							workerStage: progress.workerStage
						}
			);
			if (result.isErr()) this.exceptionLogger.captureException(result.error);
		} finally {
			this.activeObjectHeartbeatsInFlight.delete(remoteId);
		}
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
			return {
				errorMessage: error.message,
				errorType: error.response ? 'archive_http_error' : 'archive_transport_error',
				httpStatus: error.response?.status ?? null
			};
		}

		const mapped = mapUnknownToError(error);
		return {
			errorMessage: mapped.message,
			errorType: 'worker_error',
			httpStatus: null
		};
	}

	private mapLocalError(error: unknown): HistoryArchiveObjectFailureDTO {
		const mapped = mapUnknownToError(error);
		return {
			errorMessage: mapped.message,
			errorType: 'worker_error',
			httpStatus: null
		};
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
