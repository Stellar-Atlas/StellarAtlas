import type { FullHistoryCheckpointSources } from '../full-history/FullHistoryCanonicalBatch.js';
import type { FullHistoryCheckpointCandidate } from '../full-history-promotion/FullHistoryCheckpointCandidate.js';
import type { FullHistoryLedgerSequence } from '../full-history/FullHistoryCanonicalTypes.js';

export const FULL_HISTORY_OPERATION_BACKFILL_BATCH_LIMIT_MAX = 24;
export const FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS_DEFAULT = 2;
export const FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS_MAX = 12;

export interface FullHistoryOperationBackfillBatch {
	readonly archiveUrlIdentity: string;
	readonly batchId: string;
	readonly canonicalDecoderVersion: string;
	readonly checkpointLedger: FullHistoryLedgerSequence;
	readonly firstLedger: FullHistoryLedgerSequence;
	readonly lastLedger: FullHistoryLedgerSequence;
	readonly proofEvaluatedAt: Date;
	readonly proofId: number;
	readonly proofVersion: number;
	readonly sources: FullHistoryCheckpointSources;
}

export type FullHistoryOperationBackfillErrorReason =
	| 'immutable-provenance-mismatch'
	| 'invalid-batch-limit'
	| 'invalid-cpu-worker-count';

export class FullHistoryOperationBackfillError extends Error {
	constructor(
		readonly reason: FullHistoryOperationBackfillErrorReason,
		message: string
	) {
		super(message);
		this.name = 'FullHistoryOperationBackfillError';
	}
}

export function validateFullHistoryOperationBackfillLimit(limit: number): void {
	if (
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > FULL_HISTORY_OPERATION_BACKFILL_BATCH_LIMIT_MAX
	) {
		throw new FullHistoryOperationBackfillError(
			'invalid-batch-limit',
			`batchLimit must be between 1 and ${FULL_HISTORY_OPERATION_BACKFILL_BATCH_LIMIT_MAX}`
		);
	}
}

export function validateFullHistoryOperationBackfillCpuWorkerCount(
	workerCount: number
): void {
	if (
		!Number.isSafeInteger(workerCount) ||
		workerCount < 1 ||
		workerCount > FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS_MAX
	) {
		throw new FullHistoryOperationBackfillError(
			'invalid-cpu-worker-count',
			`cpuWorkerCount must be between 1 and ${FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS_MAX}`
		);
	}
}

export function assertOperationBackfillCandidateProvenance(
	batch: FullHistoryOperationBackfillBatch,
	candidate: FullHistoryCheckpointCandidate,
	networkPassphrase: string
): void {
	const proof = candidate.proof;
	if (
		proof.archiveUrlIdentity !== batch.archiveUrlIdentity ||
		proof.checkpointLedger !== batch.checkpointLedger ||
		proof.id !== batch.proofId ||
		proof.networkPassphrase !== networkPassphrase ||
		proof.version !== batch.proofVersion ||
		!sourcesMatch(proof.sources, batch.sources)
	) {
		throw new FullHistoryOperationBackfillError(
			'immutable-provenance-mismatch',
			'Checkpoint candidate no longer matches immutable canonical provenance'
		);
	}
}

function sourcesMatch(
	left: FullHistoryCheckpointSources,
	right: FullHistoryCheckpointSources
): boolean {
	return (
		sourceMatches(left.checkpointState, right.checkpointState) &&
		sourceMatches(left.ledger, right.ledger) &&
		sourceMatches(left.transactions, right.transactions) &&
		sourceMatches(left.results, right.results)
	);
}

function sourceMatches(
	left: FullHistoryCheckpointSources['ledger'],
	right: FullHistoryCheckpointSources['ledger']
): boolean {
	return (
		left.remoteId === right.remoteId &&
		left.contentDigest.equals(right.contentDigest)
	);
}
