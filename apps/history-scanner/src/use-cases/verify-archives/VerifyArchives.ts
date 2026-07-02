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
	constructor(
		private scanner: Scanner,
		@inject(TYPES.ScanCoordinatorService)
		private scanCoordinator: ScanCoordinatorService,
		@inject(TYPES.ExceptionLogger)
		private exceptionLogger: ExceptionLogger,
		@inject(TYPES.JobMonitor)
		private jobMonitor: JobMonitor
	) {}

	public async execute(verifyArchivesDTO: VerifyArchivesDTO): Promise<void> {
		const shutDown = false; //todo: implement graceful shutdown
		do {
			try {
				const scanJobDTOResult = await this.scanCoordinator.getScanJob();
				if (scanJobDTOResult.isErr()) {
					this.exceptionLogger.captureException(scanJobDTOResult.error);
					await this.waitBeforeRetry();
					continue;
				}

				await this.performScanJob(
					scanJobDTOResult.value,
					verifyArchivesDTO.persist
				);
			} catch (e) {
				//general catch all in case we missed an edge case
				this.exceptionLogger.captureException(mapUnknownToError(e));
				await this.waitBeforeRetry();
			}
		} while (!shutDown && verifyArchivesDTO.loop);
	}

	private async performScanJob(dto: ScanJobDTO, persist = false) {
		const scanJobResult = ScanJob.fromScanJobCoordinatorDTO(dto);
		if (scanJobResult.isErr()) {
			this.exceptionLogger.captureException(scanJobResult.error);
			return;
		}

		await this.checkIn('in_progress');
		await this.touchScanJob(scanJobResult.value);
		await this.perform(scanJobResult.value, persist);
		await this.touchScanJob(scanJobResult.value);
		await this.checkIn('ok');
	}

	private async perform(scanJob: ScanJob, persist = false) {
		const scan = await this.scanner.perform(new Date(), scanJob);
		if (persist) await this.persist(scan);
	}

	private async persist(scan: Scan) {
		const result = await this.scanCoordinator.registerScan(scan);
		if (result.isErr()) {
			this.exceptionLogger.captureException(result.error);
		}
	}

	private async touchScanJob(scanJob: ScanJob): Promise<void> {
		if (scanJob.remoteId === null) return;

		const result = await this.scanCoordinator.touchScanJob(scanJob.remoteId);
		if (result.isErr()) {
			this.exceptionLogger.captureException(result.error);
		}
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
