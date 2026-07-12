import type { Result } from 'neverthrow';
import type { HistoryArchiveWorkerReportDTO } from 'history-scanner-dto';

export interface HistoryArchiveWorkerStatusReporter {
	report(status: HistoryArchiveWorkerReportDTO): Promise<Result<void, Error>>;
}
