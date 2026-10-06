import { inject, injectable } from 'inversify';
import { err, ok, type Result } from 'neverthrow';
import { Url, type HttpService } from 'http-helper';
import type { ExceptionLogger } from 'exception-logger';
import type { JobMonitor } from 'job-monitor';
import type { Logger } from 'logger';
import { asyncSleep, mapUnknownToError } from 'shared';
import type { HistoryArchiveWorkerStageDTO } from 'history-scanner-dto';
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
import { ArchiveObjectHistoryStateVerifier } from './ArchiveObjectHistoryStateVerifier.js';
import { ArchiveObjectWorkerTelemetry } from './ArchiveObjectWorkerTelemetry.js';
import { ArchiveObjectTerminalQueue } from './ArchiveObjectTerminalQueue.js';
import { CoalescingHistoryArchiveWorkerReporter } from './CoalescingHistoryArchiveWorkerReporter.js';
import type { VerifyArchiveObjectsDTO } from './VerifyArchiveObjectsDTO.js';
import type {
	HistoryArchiveObjectJobDelivery,
	HistoryArchiveObjectJobSource
} from './HistoryArchiveObjectJobDelivery.js';
import { readArchiveObjectContentLength } from './ArchiveObjectHttpContentLength.js';
import { createArchiveObjectDownloadCounter } from './ArchiveObjectDownloadCounter.js';
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

const maximumPendingWorkerReports = 24;
const routineCheckInIntervalMs = 30_000;

@injectable()
export class VerifyArchiveObjects {
	private readonly categoryVerifier: ArchiveObjectCategoryVerifier;
	private readonly historyStateVerifier: ArchiveObjectHistoryStateVerifier;
	private readonly downloadPermit: HistoryArchiveDownloadPermit;
	private readonly workerTelemetry: ArchiveObjectWorkerTelemetry;
	private readonly terminalQueue: ArchiveObjectTerminalQueue;
	private stopping = false;
	private sourceClosed = false;
	private nextRoutineCheckInAt = 0;

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
		@inject(TYPES.ObjectHasherWorkerCount)
		private readonly hasherWorkerCount: number,
		@inject('Logger')
		private readonly logger: Logger,
		@inject(TYPES.HistoryArchiveContentReuseEnabled)
		private readonly contentReuseEnabled = false,
		@inject(TYPES.HistoryArchiveParsedHistoryEnabled)
		private readonly parsedHistoryEnabled = false,
		@inject(TYPES.HistoryArchiveParsedHistoryRootUrl)
		private readonly parsedHistoryRootUrl: string | null = null
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
		this.terminalQueue = new ArchiveObjectTerminalQueue(
			Math.max(Math.floor(this.workerCount), 1),
			this.scanCoordinator,
			this.workerTelemetry,
			this.logger,
			(error) => this.exceptionLogger.captureException(error),
			(status) => this.checkIn(status)
		);
		this.historyStateVerifier = new ArchiveObjectHistoryStateVerifier(
			this.httpService,
			this.historyArchiveStateValidator,
			(remoteId, workerStage, bytesDownloaded) =>
				this.workerTelemetry.updateProgress(
					remoteId,
					workerStage,
					bytesDownloaded,
					null
				)
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
			this.downloadPermit,
			this.contentReuseEnabled,
			undefined,
			this.parsedHistoryEnabled,
			this.parsedHistoryRootUrl
		);
	}

	async execute(dto: VerifyArchiveObjectsDTO): Promise<void> {
		const workerCount = Math.max(Math.floor(this.workerCount), 1);
		await Promise.all(
			Array.from({ length: workerCount }, (_, slot) =>
				this.runWorkerLoop(dto, slot)
			)
		);
		await this.terminalQueue.drain();
	}

	async releaseActiveObjectJobs(): Promise<void> {
		this.stopping = true;
		await this.terminalQueue.close();
		await this.workerTelemetry.releaseActiveObjectJobs();
		this.sourceClosed = true;
		await this.jobSource.close();
		await this.categoryVerifier.close();
	}

	private async runWorkerLoop(
		dto: VerifyArchiveObjectsDTO,
		slot: number
	): Promise<void> {
		this.workerTelemetry.reportIdle(slot);
		do {
			if (this.stopping) return;
			try {
				await this.claimAndVerifyObject(slot);
			} catch (error) {
				this.exceptionLogger.captureException(mapUnknownToError(error));
				await this.waitBeforeRetry();
			}
		} while (dto.loop && !this.stopping);
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
		this.workerTelemetry.reportIdle(slot);

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
			if (this.stopping || !this.terminalQueue.claim(job.remoteId)) {
				// A pull resolving after connection drain remains UNACKed for broker recovery.
				if (!this.sourceClosed) await delivery.retry(30_000);
				return;
			}
			this.workerTelemetry.startObject(slot, job, delivery);
			try {
				await this.checkIn('in_progress');
				await this.verifyObject(job, releasePermit, delivery);
			} catch (error) {
				try {
					if (!this.sourceClosed) await delivery.retry(30_000);
				} finally {
					await this.workerTelemetry.finishObject(job.remoteId, 'worker_issue');
					this.terminalQueue.releaseClaim(job.remoteId);
				}
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
		const result = await this.performObjectVerification(
			job,
			releaseDownloadPermit,
			delivery
		);
		releaseDownloadPermit();
		this.workerTelemetry.setStage(job.remoteId, 'recording_archive_evidence');
		if (delivery.source === 'broker')
			await this.terminalQueue.enqueue(delivery, result);
		else await this.terminalQueue.persistInline(delivery, result);
	}

	private async performObjectVerification(
		job: HistoryArchiveObjectJobDTO,
		releaseDownloadPermit: () => void,
		delivery: HistoryArchiveObjectJobDelivery
	): Promise<
		Result<HistoryArchiveObjectCompletionDTO, HistoryArchiveObjectFailureDTO>
	> {
		switch (job.objectType) {
			case 'history-archive-state':
				return this.historyStateVerifier.verify(job, releaseDownloadPermit);
			case 'checkpoint-state':
				return this.categoryVerifier.verifyCheckpointState(
					job,
					releaseDownloadPermit
				);
			case 'ledger':
			case 'transactions':
			case 'results':
			case 'scp':
				return this.categoryVerifier.verifyCategoryObject(
					job,
					releaseDownloadPermit,
					delivery.source === 'broker' ? delivery.executionId : undefined
				);
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
		if (urlResult.isErr())
			return err(mapArchiveObjectLocalError(urlResult.error));

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
			if (response.isErr())
				return err(mapArchiveObjectHttpError(response.error));
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
				(streamToVerify) => verifyBucketHash(streamToVerify, job.bucketHash!)
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
		if (status !== 'error') {
			const now = Date.now();
			if (now < this.nextRoutineCheckInAt) return;
			this.nextRoutineCheckInAt = now + routineCheckInIntervalMs;
			this.logger.info(
				'Archive terminal persistence queue',
				this.terminalQueue.metrics
			);
		}

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
}
