import type { HistoryArchiveObject } from '../history-archive-object/HistoryArchiveObject.js';

export interface HistoryArchiveCheckpointProofRefreshTarget {
	readonly archiveUrlIdentity: string;
	readonly bucketHash?: string | null;
	readonly checkpointLedger?: number | null;
}

export interface HistoryArchiveCheckpointProofRepository {
	refreshForArchiveCheckpoint(
		target: HistoryArchiveCheckpointProofRefreshTarget
	): Promise<void>;
	refreshForObject(object: HistoryArchiveObject): Promise<void>;
}
