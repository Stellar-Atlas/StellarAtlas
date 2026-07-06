export interface ScheduleScansDTO {
	readonly historyArchiveUrls: readonly string[];
}

export interface ScheduleScanJobsResultDTO {
	readonly discoveredArchiveUrlCount: number;
	readonly scheduledArchiveScanJobCount: number;
	readonly duplicateSuppressedArchiveScanJobCount: number;
	readonly schedulerErrorCount: number;
}
