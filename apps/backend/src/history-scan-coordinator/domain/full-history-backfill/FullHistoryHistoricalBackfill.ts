import {
	assertInteger,
	fullHistoryLedgerSequence,
	type FullHistoryHash,
	type FullHistoryLedgerSequence,
	type FullHistoryUint64String
} from '../full-history/FullHistoryCanonicalTypes.js';

export const FULL_HISTORY_BACKFILL_CHECKPOINT_MIN = 1;
export const FULL_HISTORY_BACKFILL_CHECKPOINT_MAX = 8;
export const FULL_HISTORY_BACKFILL_MAX_ATTEMPTS = 32_767;

export type FullHistoryHistoricalBackfillJobState =
	'completed' | 'failed' | 'leased' | 'pending';

export interface FullHistoryHistoricalBackfillRange {
	readonly checkpointCount: number;
	readonly firstCheckpointLedger: FullHistoryLedgerSequence;
	readonly lastCheckpointLedger: FullHistoryLedgerSequence;
}

export interface FullHistoryHistoricalFrontier {
	readonly firstBatchId: string;
	readonly firstLedger: FullHistoryLedgerSequence;
	readonly lastBatchId: string;
	readonly nextLedger: FullHistoryUint64String;
	readonly updatedAt: Date;
}

export interface FullHistoryHistoricalBackfillJob {
	readonly attemptCount: number;
	readonly availableAt: Date;
	readonly completedAt: Date | null;
	readonly createdAt: Date;
	readonly id: string;
	readonly lastErrorCode: string | null;
	readonly leaseExpiresAt: Date | null;
	readonly leaseOwner: string | null;
	readonly leaseToken: string | null;
	readonly maxAttempts: number;
	readonly networkPassphraseHash: FullHistoryHash;
	readonly range: FullHistoryHistoricalBackfillRange;
	readonly state: FullHistoryHistoricalBackfillJobState;
	readonly updatedAt: Date;
}

export function fullHistoryHistoricalBackfillRange(
	firstCheckpointLedger: string | bigint,
	lastCheckpointLedger: string | bigint
): FullHistoryHistoricalBackfillRange {
	const first = fullHistoryCheckpointLedger(
		firstCheckpointLedger,
		'firstCheckpointLedger'
	);
	const last = fullHistoryCheckpointLedger(
		lastCheckpointLedger,
		'lastCheckpointLedger'
	);
	const distance = BigInt(last) - BigInt(first);
	if (distance < 0n || distance % 64n !== 0n) {
		throw new RangeError('Historical backfill checkpoints must be contiguous');
	}
	const checkpointCount = Number(distance / 64n + 1n);
	assertInteger(
		checkpointCount,
		'checkpointCount',
		FULL_HISTORY_BACKFILL_CHECKPOINT_MIN,
		FULL_HISTORY_BACKFILL_CHECKPOINT_MAX
	);
	return {
		checkpointCount,
		firstCheckpointLedger: first,
		lastCheckpointLedger: last
	};
}

export function firstLedgerForCheckpoint(
	checkpointLedger: FullHistoryLedgerSequence
): FullHistoryLedgerSequence {
	const checkpoint = BigInt(checkpointLedger);
	return fullHistoryLedgerSequence(
		checkpoint === 63n ? 1n : checkpoint - 63n,
		'firstLedger'
	);
}

export function fullHistoryCheckpointLedger(
	value: string | bigint,
	field = 'checkpointLedger'
): FullHistoryLedgerSequence {
	const checkpoint = fullHistoryLedgerSequence(value, field);
	if (BigInt(checkpoint) < 63n || BigInt(checkpoint) % 64n !== 63n) {
		throw new RangeError(`${field} must be a global Stellar checkpoint ledger`);
	}
	return checkpoint;
}
