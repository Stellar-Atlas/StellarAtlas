import { ScanJob } from './ScanJob.js';

export interface ScanJobRepository {
	hasPendingJobs: () => Promise<boolean>;
	save: (scanJobs: ScanJob[]) => Promise<void>;
	fetchNextJob: () => Promise<ScanJob | null>;
	findActiveByUrl: (url: string, limit: number) => Promise<ScanJob[]>;
	findByRemoteId: (remoteId: string) => Promise<ScanJob | null>;
	findUnfinishedJobs: (after: Date) => Promise<ScanJob[]>;
	markTakenJobActive: (remoteId: string) => Promise<boolean>;
	releaseStaleTakenJobs: (before: Date) => Promise<number>;
}
