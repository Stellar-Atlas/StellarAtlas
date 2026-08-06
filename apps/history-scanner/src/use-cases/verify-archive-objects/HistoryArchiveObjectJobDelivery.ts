import type { HistoryArchiveObjectJobDTO } from '../../domain/scan/ScanCoordinatorService.js';

export type HistoryArchiveObjectJobSourceKind = 'broker' | 'legacy-http';

export interface HistoryArchiveObjectJobLease {
	heartbeat(): Promise<void>;
	release(): Promise<void>;
}

export interface HistoryArchiveObjectJobDelivery
	extends HistoryArchiveObjectJobLease {
	readonly executionId: string;
	readonly job: HistoryArchiveObjectJobDTO;
	readonly source: HistoryArchiveObjectJobSourceKind;
	acknowledge(): Promise<void>;
	retry(delayMs: number): Promise<void>;
}

export interface HistoryArchiveObjectJobSource {
	readonly kind: HistoryArchiveObjectJobSourceKind;
	next(): Promise<HistoryArchiveObjectJobDelivery | null>;
	close(): Promise<void>;
}
