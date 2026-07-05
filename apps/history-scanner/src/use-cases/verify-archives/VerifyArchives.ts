import { Scanner } from '../../domain/scanner/Scanner.js';
import type { ScanCoordinatorService } from '../../domain/scan/ScanCoordinatorService.js';
import type { ExceptionLogger } from 'exception-logger';
import { mapUnknownToError } from 'shared';
import { Scan } from '../../domain/scan/Scan.js';
import { asyncSleep } from 'shared';
import { VerifyArchivesDTO } from './VerifyArchivesDTO.js';
import { ScanJob } from '../../domain/scan/ScanJob.js';
import type { JobMonitor } from 'job-monitor';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { ScanJobDTO } from 'history-scanner-dto';

@injectable()
export class VerifyArchives {
	private static readonly scanJobHeartbeatIntervalMs = 60 * 1000;

	constructor(
		private scanner: Scanner,
		@inject(TYPES.ScanCoordinatorService)
		private scanCoordinator: ScanCoordinatorService,
		@inject(TYPES.ExceptionLogger)
		private exceptionLogger: ExceptionLogger,
		@inject(TYPES.JobMonitor)
		private jobMonitor: JobMonitor,
		@inject(TYPES.ScanWorkerCount)
		private readonly scanWorkerCount: number
	) {}

	public async execute(verifyArchivesDTO: VerifyArchivesDTO): Promise<void> {
		const workerCount = Math.max(Math.floor(this.scanWorkerCount), 1);
		await Promise.all(
			Array.from({ length: workerCount }, () =>
				this.runWorkerLoop(verifyArchivesDTO)
			)
		);
	}

	private async runWorkerLoop(
		verifyArchivesDTO: VerifyArchivesDTO
	): Promise<void> {
		do {
			try {
				await this.claimAndPerformScanJob(verifyArchivesDTO.persist);
			} catch (e) {
				//general catch all in case we missed an edge case
				this.exceptionLogger.captureException(mapUnknownToError(e));
				await this.waitBeforeRetry();
			}
		} while (verifyArchivesDTO.loop);
	}

	private async claimAndPerformScanJob(persist: boolean): Promise<void> {
		const scanJobDTOResult = await this.scanCoordinator.getScanJob();
		if (scanJobDTOResult.isErr()) {
			this.exceptionLogger.captureException(scanJobDTOResult.error);
			await this.waitBeforeRetry();
			return;
		}
		if (scanJobDTOResult.value === null) {
			await this.waitBeforeRetry();
			return;
		}

		await this.performScanJob(scanJobDTOResult.value, persist);
	}

	private async performScanJob(dto: ScanJobDTO, persist = false) {
		const scanJobResult = ScanJob.fromScanJobCoordinatorDTO(dto);
		if (scanJobResult.isErr()) {
			this.exceptionLogger.captureException(scanJobResult.error);
			return;
		}

		await this.checkIn('in_progress');
		await this.touchScanJob(scanJobResult.value);
		const stopHeartbeat = this.startScanJobHeartbeat(scanJobResult.value);
		let scanCompleted = false;
		try {
			scanCompleted = await this.perform(scanJobResult.value, persist);
			await this.checkIn('ok');
		} finally {
			stopHeartbeat();
			if (!scanCompleted) await this.touchScanJob(scanJobResult.value);
		}
	}

	private async perform(scanJob: ScanJob, persist = false): Promise<boolean> {
		const scan = await this.scanner.perform(new Date(), scanJob);
		if (persist) return await this.persist(scan);
		return false;
	}

	private async persist(scan: Scan): Promise<boolean> {
		const result = await this.scanCoordinator.registerScan(scan);
		if (result.isErr()) {
			this.exceptionLogger.captureException(result.error);
			return false;
		}
		return true;
	}

	private async touchScanJob(scanJob: ScanJob): Promise<void> {
		if (scanJob.remoteId === null) return;

		const result = await this.scanCoordinator.touchScanJob(scanJob.remoteId);
		if (result.isErr()) {
			this.exceptionLogger.captureException(result.error);
		}
	}

	private startScanJobHeartbeat(scanJob: ScanJob): () => void {
		const heartbeat = setInterval(() => {
			void this.touchScanJob(scanJob);
		}, VerifyArchives.scanJobHeartbeatIntervalMs);

		return () => {
			clearInterval(heartbeat);
		};
	}

	private async checkIn(status: 'in_progress' | 'error' | 'ok') {
		const result = await this.jobMonitor.checkIn({
			context: 'verify-archive',
			status
		});

		if (result.isErr()) {
			this.exceptionLogger.captureException(result.error);
		}
	}

	protected async waitBeforeRetry(): Promise<void> {
		await asyncSleep(60 * 1000);
	}
}
