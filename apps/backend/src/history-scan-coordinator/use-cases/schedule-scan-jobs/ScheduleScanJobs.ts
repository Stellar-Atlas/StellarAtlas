import 'reflect-metadata';
import { err, ok, Result } from 'neverthrow';
import type {
	ScheduleScanJobsResultDTO,
	ScheduleScansDTO as ScheduleScanJobsDTO
} from './ScheduleScanJobsDTO.js';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../infrastructure/di/di-types.js';
import type { Logger } from 'logger';
import type { ScanJobRepository } from '../../domain/ScanJobRepository.js';
import { getStaleScanJobCutoff } from '../../domain/ScanJobStaleness.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { ScheduleHistoryArchiveObjects } from '../schedule-history-archive-objects/ScheduleHistoryArchiveObjects.js';

/**
 * Compatibility wrapper used by the network scanner. It now schedules archive
 * object checks, not whole-archive ledger-range jobs.
 */
@injectable()
export class ScheduleScanJobs {
	constructor(
		@inject(TYPES.ScanJobRepository)
		private readonly scanJobRepository: ScanJobRepository,
		@inject('Logger') private readonly logger: Logger,
		private readonly objectScheduler: ScheduleHistoryArchiveObjects
	) {}

	public async execute(
		dto: ScheduleScanJobsDTO
	): Promise<Result<ScheduleScanJobsResultDTO, Error>> {
		try {
			const result = await this.scanJobRepository.withSchedulingLock(
				async () => {
					await this.releaseStaleRangeJobs();
					const objectScheduleResult = await this.objectScheduler.execute(
						dto.historyArchiveUrls
					);
					if (objectScheduleResult.isErr()) {
						throw objectScheduleResult.error;
					}

					return objectScheduleResult.value;
				}
			);

			return ok(result);
		} catch (e) {
			const error = mapUnknownToError(e);
			this.logger.error('Failed to schedule history archive objects', {
				app: 'history-scan-coordinator',
				errorMessage: error.message
			});

			return err(error);
		}
	}

	private async releaseStaleRangeJobs(): Promise<void> {
		const released = await this.scanJobRepository.releaseStaleTakenJobs(
			getStaleScanJobCutoff()
		);

		if (released > 0) {
			this.logger.info('Released stale legacy archive range jobs', {
				app: 'history-scan-coordinator',
				released
			});
		}
	}
}
