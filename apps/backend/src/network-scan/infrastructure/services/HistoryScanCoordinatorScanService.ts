import type { HistoryArchiveScanService } from '../../domain/node/scan/history/HistoryArchiveScanService.js';
import type { HistoryArchiveSchedulingResult } from '../../domain/node/scan/history/HistoryArchiveScanService.js';
import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { inject, injectable } from 'inversify';
import { HistoryArchiveScan } from 'shared';
import { TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import { ScheduleScanJobs } from '@history-scan-coordinator/use-cases/schedule-scan-jobs/ScheduleScanJobs.js';
import { mapScanToHistoryArchiveScan } from '@history-scan-coordinator/infrastructure/mappers/mapScanToHistoryArchiveScan.js';

//Connects with the HistoryScanCoordinator module
@injectable()
export class HistoryScanCoordinatorScanService implements HistoryArchiveScanService {
	//TODO: should not call repository directly, should call use case
	constructor(
		@inject(TYPES.HistoryArchiveScanRepository)
		private historyArchiveScanRepository: ScanRepository,
		private scheduleScansUseCase: ScheduleScanJobs
	) {}

	async scheduleScans(
		historyArchiveUrls: string[]
	): Promise<Result<HistoryArchiveSchedulingResult, Error>> {
		return this.scheduleScansUseCase.execute({
			historyArchiveUrls
		});
	}

	async findLatestHistoricalRangeScans(): Promise<
		Result<HistoryArchiveScan[], Error>
	> {
		try {
			const scans = await this.historyArchiveScanRepository.findLatest();
			const finishedScans = scans.filter((scan) => scan.endDate !== undefined);
			return ok(finishedScans.map(mapScanToHistoryArchiveScan));
		} catch (e) {
			return err(mapUnknownToError(e));
		}
	}
}
