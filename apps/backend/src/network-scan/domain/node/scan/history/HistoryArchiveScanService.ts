import type { Result } from 'neverthrow';
import type { HistoryArchiveScan } from 'shared';

export interface HistoryArchiveSchedulingResult {
	readonly discoveredArchiveUrlCount: number;
	readonly scheduledArchiveScanJobCount: number;
	readonly duplicateSuppressedArchiveScanJobCount: number;
	readonly schedulerErrorCount: number;
}

export interface HistoryArchiveScanService {
	findLatestHistoricalRangeScans(): Promise<
		Result<HistoryArchiveScan[], Error>
	>;
	scheduleScans(
		historyArchiveUrls: string[]
	): Promise<Result<HistoryArchiveSchedulingResult, Error>>;
}
