import type { HistoryArchiveObject } from '../history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveCheckpointProof } from './HistoryArchiveCheckpointProof.js';

export interface HistoryArchiveCheckpointProofRefreshTarget {
	readonly archiveUrlIdentity: string;
	readonly bucketHash?: string | null;
	readonly checkpointLedger?: number | null;
}

export interface HistoryArchiveCheckpointProofRepository {
	findActionableByArchiveUrlIdentity(
		archiveUrlIdentity: string,
		limit: number
	): Promise<readonly HistoryArchiveCheckpointProof[]>;
	refreshForArchiveCheckpoint(
		target: HistoryArchiveCheckpointProofRefreshTarget
	): Promise<void>;
	refreshForObject(object: HistoryArchiveObject): Promise<void>;
}
