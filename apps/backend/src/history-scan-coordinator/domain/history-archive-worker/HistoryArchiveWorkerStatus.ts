import type {
	HistoryArchiveObjectTypeDTO,
	HistoryArchiveWorkerOutcomeDTO,
	HistoryArchiveWorkerReportDTO,
	HistoryArchiveWorkerStageDTO
} from 'history-scanner-dto';

export interface HistoryArchiveWorkerCurrentObject {
	readonly remoteId: string;
	readonly source: string;
	readonly type: HistoryArchiveObjectTypeDTO;
}

export interface HistoryArchiveWorkerStatus {
	readonly bytesDownloaded: number | null;
	readonly bytesTotal: number | null;
	readonly claimAttempt: number | null;
	readonly currentObject: HistoryArchiveWorkerCurrentObject | null;
	readonly heartbeatAt: Date;
	readonly lastOutcome: HistoryArchiveWorkerOutcomeDTO;
	readonly lastOutcomeAt: Date | null;
	readonly pid: number;
	readonly processGeneration: number;
	readonly processId: string;
	readonly processStartedAt: Date;
	readonly sequence: number;
	readonly slotIndex: number;
	readonly stage: HistoryArchiveWorkerStageDTO;
	readonly workerId: string;
}

export interface HistoryArchiveWorkerStatusRepository {
	findRecent(options: {
		readonly limit: number;
		readonly observedAfter: Date;
		readonly pruneBefore: Date;
	}): Promise<readonly HistoryArchiveWorkerStatus[]>;
	report(
		report: HistoryArchiveWorkerReportDTO,
		heartbeatAt: Date
	): Promise<void>;
}
