export interface PublicHistoricalFullHistoryBackfill {
	readonly completedCheckpoints?: number;
	readonly completedJobs?: number;
	readonly currentProof?: PublicHistoricalFullHistoryCheckpointProof | null;
	readonly failedJobs: number;
	readonly latestErrorCode: string | null;
	readonly nextCheckpointLedger: string | null;
	readonly pendingJobs: number;
	readonly runningJobs: number;
	readonly state:
		'complete' | 'failed' | 'idle' | 'queued' | 'running' | 'waiting-for-proof';
	readonly updatedAt: string | null;
}

export type PublicHistoricalFullHistoryProofFailureKind =
	| 'object-incomplete'
	| 'object-failed'
	| 'proof-facts-incomplete'
	| 'checkpoint-ledger-mismatch'
	| 'checkpoint-bucket-list-mismatch'
	| 'transaction-hash-mismatch'
	| 'result-hash-mismatch'
	| 'predecessor-missing'
	| 'previous-ledger-hash-mismatch'
	| 'bucket-missing';

export interface PublicHistoricalFullHistoryCheckpointProof {
	readonly checkpointLedger: string;
	readonly expectedBucketCount: number;
	readonly failureKind: PublicHistoricalFullHistoryProofFailureKind | null;
	readonly remainingBucketCount: number;
	readonly status: 'pending' | 'verified' | 'mismatch' | 'not-evaluable';
	readonly verifiedBucketCount: number;
}
