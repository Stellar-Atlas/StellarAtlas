import { Result } from 'neverthrow';
import { HistoryArchiveScan } from 'shared';

export interface HistoryArchiveSchedulingResult {
	readonly discoveredArchiveUrlCount: number;
	readonly scheduledArchiveScanJobCount: number;
	readonly duplicateSuppressedArchiveScanJobCount: number;
	readonly schedulerErrorCount: number;
}

export interface HistoryArchiveScanService {
	findLatestScans(): Promise<Result<HistoryArchiveScan[], Error>>;
	scheduleScans(
		historyArchiveUrls: string[]
	): Promise<Result<HistoryArchiveSchedulingResult, Error>>;
}
