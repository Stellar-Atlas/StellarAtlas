import {
	FULL_HISTORY_BACKFILL_CHECKPOINT_MAX,
	fullHistoryCheckpointLedger,
	fullHistoryHistoricalBackfillRange,
	firstLedgerForCheckpoint,
	type FullHistoryHistoricalBackfillJob,
	type FullHistoryHistoricalBackfillRange,
	type FullHistoryHistoricalFrontier
} from './FullHistoryHistoricalBackfill.js';
import { assertInteger } from '../full-history/FullHistoryCanonicalTypes.js';

export function adjacentHistoricalBackfillRange(
	frontier: FullHistoryHistoricalFrontier,
	requestedCheckpointCount: number
): FullHistoryHistoricalBackfillRange | null {
	const requested = assertInteger(
		requestedCheckpointCount,
		'requestedCheckpointCount',
		1,
		FULL_HISTORY_BACKFILL_CHECKPOINT_MAX
	);
	const firstLedger = BigInt(frontier.firstLedger);
	if (firstLedger === 1n) return null;
	if (firstLedger % 64n !== 0n) {
		throw new Error('Canonical lower frontier is not checkpoint-aligned');
	}
	const lastCheckpoint = firstLedger - 1n;
	const availableCheckpoints = Number((lastCheckpoint - 63n) / 64n + 1n);
	const checkpointCount = Math.min(requested, availableCheckpoints);
	const firstCheckpoint = lastCheckpoint - BigInt(checkpointCount - 1) * 64n;
	return fullHistoryHistoricalBackfillRange(firstCheckpoint, lastCheckpoint);
}

export function nextHistoricalBackfillCheckpoint(
	frontier: FullHistoryHistoricalFrontier,
	job: FullHistoryHistoricalBackfillJob
): number | null {
	const currentFirst = BigInt(frontier.firstLedger);
	const rangeFirst = BigInt(
		firstLedgerForCheckpoint(job.range.firstCheckpointLedger)
	);
	if (currentFirst <= rangeFirst) return null;

	const rangeUpper = BigInt(job.range.lastCheckpointLedger) + 1n;
	if (currentFirst > rangeUpper) {
		throw new Error(
			'Historical job has not reached the canonical lower frontier'
		);
	}
	const checkpoint = fullHistoryCheckpointLedger(
		currentFirst - 1n,
		'nextHistoricalCheckpoint'
	);
	if (
		BigInt(checkpoint) < BigInt(job.range.firstCheckpointLedger) ||
		BigInt(checkpoint) > BigInt(job.range.lastCheckpointLedger)
	) {
		throw new Error(
			'Canonical lower frontier is outside the historical job range'
		);
	}
	return Number(checkpoint);
}
