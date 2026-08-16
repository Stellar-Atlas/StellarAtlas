export interface HistoryArchiveRepairArtifactWorkLease {
	release(): Promise<void>;
}

export interface HistoryArchiveRepairArtifactWorkPermit {
	tryAcquire(): Promise<HistoryArchiveRepairArtifactWorkLease | null>;
}
