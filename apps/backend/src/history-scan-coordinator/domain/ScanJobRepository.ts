import { ScanJob } from './ScanJob.js';

export interface ArchiveScanQueueStats {
	readonly pendingJobs: number;
	readonly activeJobs: number;
	readonly staleJobs: number;
	readonly totalUnfinishedJobs: number;
}

export interface ArchiveScanTakenJobsSnapshot {
	readonly activeTakenJobs: number;
	readonly staleTakenJobs: number;
	readonly totalTakenJobs: number;
	readonly jobs: readonly ScanJob[];
}

export interface ScanJobProgressUpdate {
	readonly concurrency?: number;
	readonly fromLedger?: number;
	readonly latestScannedLedger?: number;
	readonly latestScannedLedgerHeaderHash?: string | null;
	readonly toLedger?: number | null;
}

export interface ScanJobRepository {
	withSchedulingLock: <T>(work: () => Promise<T>) => Promise<T>;
	hasPendingJobs: () => Promise<boolean>;
	save: (scanJobs: ScanJob[]) => Promise<void>;
	fetchNextJob: () => Promise<ScanJob | null>;
	fetchNextJobForCommunityScanner: (
		communityScannerId: string,
		activeJobLimit: number,
		staleTakenBefore: Date
	) => Promise<ScanJob | null>;
	findActiveByUrl: (url: string, limit: number) => Promise<ScanJob[]>;
	findByRemoteId: (remoteId: string) => Promise<ScanJob | null>;
	findUnfinishedJobs: (after: Date) => Promise<ScanJob[]>;
	getQueueStats: (staleTakenBefore: Date) => Promise<ArchiveScanQueueStats>;
	getTakenJobsSnapshot: (
		staleTakenBefore: Date,
		limit: number
	) => Promise<ArchiveScanTakenJobsSnapshot>;
	markTakenJobActive: (
		remoteId: string,
		progress?: ScanJobProgressUpdate
	) => Promise<boolean>;
	markTakenJobActiveForCommunityScanner: (
		remoteId: string,
		communityScannerId: string,
		progress?: ScanJobProgressUpdate
	) => Promise<boolean>;
	releaseTakenJob: (remoteId: string) => Promise<boolean>;
	releaseStaleTakenJobs: (before: Date) => Promise<number>;
}
