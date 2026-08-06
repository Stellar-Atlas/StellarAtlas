import { inject, injectable } from 'inversify';
import { err, ok, type Result } from 'neverthrow';
import { Url, type HttpService } from 'http-helper';
import type { ExceptionLogger } from 'exception-logger';
import type { JobMonitor } from 'job-monitor';
import type { Logger } from 'logger';
import { asyncSleep, mapUnknownToError } from 'shared';
import type {
	HistoryArchiveWorkerOutcomeDTO,
	HistoryArchiveWorkerStageDTO
} from 'history-scanner-dto';
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
import type {
	HistoryArchiveObjectJobDelivery,
	HistoryArchiveObjectJobSource
} from './HistoryArchiveObjectJobDelivery.js';
import { canonicalJsonContentDigest } from './ArchiveObjectContentDigest.js';
import { readArchiveObjectContentLength } from './ArchiveObjectHttpContentLength.js';
import { createArchiveObjectDownloadCounter } from './ArchiveObjectDownloadCounter.js';
import { retryArchiveObjectTerminalUpdate } from './ArchiveObjectTerminalUpdate.js';
import {
	isReadableArchiveObject,
	mapArchiveObjectHttpError,
	mapArchiveObjectLocalError,
	verifyBucketHash
} from './ArchiveObjectWorkerHelpers.js';
import {
	type HistoryArchiveDownloadPermit,
	ProcessHistoryArchiveDownloadPermit
} from '../../infrastructure/services/HistoryArchiveDownloadPermit.js';
import {
	archiveAvailabilityFailure,
	archiveEvidenceFailure,
	scannerIssueFailure
} from './ArchiveObjectFailure.js';
import { logArchiveObjectFailure } from './ArchiveObjectFailureLogger.js';

const maximumPendingWorkerReports = 24;

@injectable()
export class VerifyArchiveObjects {
	private readonly categoryVerifier: ArchiveObjectCategoryVerifier;
	private readonly downloadPermit: HistoryArchiveDownloadPermit;
	private readonly workerTelemetry: ArchiveObjectWorkerTelemetry;

	constructor(
		@inject(TYPES.ScanCoordinatorService)
		private readonly scanCoordinator: ScanCoordinatorService,
		@inject(TYPES.HistoryArchiveObjectJobSource)
		private readonly jobSource: HistoryArchiveObjectJobSource,
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
		this.downloadPermit = new ProcessHistoryArchiveDownloadPermit();
		const coalescingStatusReporter = new CoalescingHistoryArchiveWorkerReporter(
			workerStatusReporter,
			this.exceptionLogger,
			maximumPendingWorkerReports
		);
		this.workerTelemetry = new ArchiveObjectWorkerTelemetry(
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
			(remoteId, workerStage, bytesDownloaded, bytesTotal) =>
				this.workerTelemetry.updateProgress(
					remoteId,
					workerStage,
					bytesDownloaded,
					bytesTotal
				),
			(remoteId, workerStage, bytesDownloaded, bytesTotal) =>
				this.workerTelemetry.updateProgressAndFlush(
					remoteId,
					workerStage,
					bytesDownloaded,
					bytesTotal
				),
			this.downloadPermit
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
		await this.jobSource.close();
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
		this.workerTelemetry.startWaitingForDownloadSlot(slot);
		let releaseDownloadPermit: (() => void) | null = null;
		try {
			releaseDownloadPermit = await this.downloadPermit.acquire();
		} catch (error) {
			this.workerTelemetry.reportIdle(slot);
			throw error;
		}
		this.workerTelemetry.stopWaitingForDownloadSlot(slot);

		let permitReleased = false;
		const releasePermit = (): void => {
			if (permitReleased || releaseDownloadPermit === null) return;
			permitReleased = true;
			releaseDownloadPermit();
		};

		try {
			let delivery: HistoryArchiveObjectJobDelivery | null;
			try {
				delivery = await this.jobSource.next();
			} catch (error) {
				this.workerTelemetry.reportIdle(slot);
				throw error;
			}
			if (delivery === null) {
				this.workerTelemetry.reportIdle(slot);
				if (this.jobSource.kind === 'legacy-http') await this.waitBeforeRetry();
				return;
			}

			const job = delivery.job;
			this.workerTelemetry.startObject(slot, job, delivery);
			await this.checkIn('in_progress');
			try {
				await this.verifyObject(job, releasePermit, delivery);
			} catch (error) {
				await delivery.retry(30_000);
				throw error;
			}
		} finally {
			releasePermit();
		}
	}

	private async verifyObject(
		job: HistoryArchiveObjectJobDTO,
		releaseDownloadPermit: () => void,
		delivery: HistoryArchiveObjectJobDelivery
	): Promise<void> {
		let outcome: HistoryArchiveWorkerOutcomeDTO = 'worker_issue';
		try {
			const result = await this.performObjectVerification(
				job,
				releaseDownloadPermit
			);
			if (result.isErr()) {
				outcome = mapFailureToWorkerOutcome(result.error);
				this.workerTelemetry.setStage(
					job.remoteId,
					'recording_archive_evidence'
				);
				await retryArchiveObjectTerminalUpdate(
					() =>
						this.scanCoordinator.failHistoryArchiveObject(job.remoteId, {
							...result.error,
							claimAttempt: job.claimAttempt,
							executionId: delivery.executionId,
							scheduler:
								delivery.source === 'broker' ? 'broker' : 'legacy'
						}),
					(error) => this.exceptionLogger.captureException(error)
				);
				await delivery.acknowledge();
				logArchiveObjectFailure(this.logger, job.remoteId, result.error);
				await this.checkIn(
					result.error.failureChannel === 'scanner_issue' ? 'error' : 'ok'
				);
				return;
			}
			this.workerTelemetry.setStage(
				job.remoteId,
				'recording_archive_evidence'
			);
			await retryArchiveObjectTerminalUpdate(
				() =>
					this.scanCoordinator.completeHistoryArchiveObject(job.remoteId, {
						...result.value,
						claimAttempt: job.claimAttempt,
						executionId: delivery.executionId,
						scheduler:
							delivery.source === 'broker' ? 'broker' : 'legacy'
					}),
				(error) => this.exceptionLogger.captureException(error)
			);
			await delivery.acknowledge();
			outcome = 'verified';
			await this.checkIn('ok');
		} finally {
			await this.workerTelemetry.finishObject(job.remoteId, outcome);
		}
	}

	private async performObjectVerification(
		job: HistoryArchiveObjectJobDTO,
		releaseDownloadPermit: () => void
	): Promise<
		Result<HistoryArchiveObjectCompletionDTO, HistoryArchiveObjectFailureDTO>
	> {
		switch (job.objectType) {
			case 'history-archive-state':
				return this.verifyHistoryArchiveState(job, releaseDownloadPermit);
			case 'checkpoint-state':
				return this.categoryVerifier.verifyCheckpointState(job, releaseDownloadPermit);
			case 'ledger':
			case 'transactions':
			case 'results':
			case 'scp':
				return this.categoryVerifier.verifyCategoryObject(job, releaseDownloadPermit);
			case 'bucket':
				return this.verifyBucket(job, releaseDownloadPermit);
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
		job: HistoryArchiveObjectJobDTO,
		releaseDownloadPermit: () => void
	): Promise<
		Result<HistoryArchiveObjectCompletionDTO, HistoryArchiveObjectFailureDTO>
	> {
		const urlResult = Url.create(job.objectUrl);
		if (urlResult.isErr()) return err(mapArchiveObjectLocalError(urlResult.error));

		this.workerTelemetry.updateProgress(
			job.remoteId,
			'fetching_history_archive_state',
			null,
			null
		);
		const response = await this.httpService
			.get(urlResult.value, {
				responseType: 'json',
				connectionTimeoutMs: 5_000,
				socketTimeoutMs: 10_000
			})
			.finally(releaseDownloadPermit);
		if (response.isErr()) return err(mapArchiveObjectHttpError(response.error));

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
			bytesDownloaded,
			null
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
		job: HistoryArchiveObjectJobDTO,
		releaseDownloadPermit: () => void
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

		const urlResult = Url.create(job.objectUrl);
		if (urlResult.isErr()) return err(mapArchiveObjectLocalError(urlResult.error));

		this.workerTelemetry.updateProgress(
			job.remoteId,
			'fetching_bucket',
			0,
			null
		);
		try {
			const response = await this.httpService.get(urlResult.value, {
				responseType: 'stream',
				connectionTimeoutMs: 10_000,
				socketTimeoutMs: 60_000
			});
			if (response.isErr()) return err(mapArchiveObjectHttpError(response.error));
			if (!isReadableArchiveObject(response.value.data)) {
				return err({
					errorMessage: 'Bucket response must be a readable stream',
					errorType: 'invalid_bucket_response',
					failureChannel: 'scanner_issue',
					httpStatus: response.value.status
				});
			}
			const bytesTotal = readArchiveObjectContentLength(response.value.headers);
			let activeWorkerStage: HistoryArchiveWorkerStageDTO =
				'downloading_bucket';
			this.workerTelemetry.updateProgress(
				job.remoteId,
				activeWorkerStage,
				0,
				bytesTotal
			);

			let bytesDownloaded = 0;
			const counter = createArchiveObjectDownloadCounter(
				(bytes) => {
					bytesDownloaded += bytes;
					this.workerTelemetry.updateProgress(
						job.remoteId,
						activeWorkerStage,
						bytesDownloaded,
						bytesTotal
					);
				},
				async () => {
					activeWorkerStage = 'verifying_bucket';
					await this.workerTelemetry.updateProgressAndFlush(
						job.remoteId,
						activeWorkerStage,
						bytesDownloaded,
						bytesTotal
					);
					releaseDownloadPermit();
				}
			);
			response.value.data.on('error', (error) => counter.destroy(error));
			const countedStream = response.value.data.pipe(counter);
			const verifyResult = await this.bucketCache.verifyAndStore(
				job.bucketHash.toLowerCase(),
				countedStream,
				(streamToVerify) =>
					verifyBucketHash(streamToVerify, job.bucketHash!)
			);
			if (verifyResult.isErr()) {
				if (verifyResult.error.kind === 'source-stream') {
					return err(
						archiveAvailabilityFailure({
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
				bytesDownloaded,
				bytesTotal
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
		} finally {
			releaseDownloadPermit();
		}
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

}
