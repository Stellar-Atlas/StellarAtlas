import {
	fullHistoryLedgerSequence,
	type FullHistoryHash,
	type FullHistoryLedgerSequence
} from './FullHistoryCanonicalTypes.js';

export const FULL_HISTORY_LEDGER_RANGE_LIMIT_MAX = 100;

export interface FullHistoryLedgerView {
	readonly bucketListHash: FullHistoryHash;
	readonly closedAt: Date;
	readonly ledgerHash: FullHistoryHash;
	readonly ledgerSequence: FullHistoryLedgerSequence;
	readonly operationCount: number;
	readonly previousLedgerHash: FullHistoryHash;
	readonly protocolVersion: number;
	readonly transactionCount: number;
	readonly transactionResultHash: FullHistoryHash;
	readonly transactionSetHash: FullHistoryHash;
}

export interface FullHistoryCanonicalLedgerEvidenceView {
	readonly archiveUrlIdentity: string;
	readonly batchId: string;
	readonly checkpointLedger: FullHistoryLedgerSequence;
	readonly checkpointProofId: number;
	readonly decoderVersion: string;
	readonly ingestedAt: Date;
	readonly ledgerSourceObject: {
		readonly contentDigest: FullHistoryHash;
		readonly objectRemoteId: string;
	};
	readonly proofEvaluatedAt: Date;
	readonly proofVersion: number;
}

export interface FullHistoryCanonicalLedgerView extends FullHistoryLedgerView {
	readonly evidence: FullHistoryCanonicalLedgerEvidenceView;
}

export interface FullHistoryLedgerRangeQuery {
	readonly firstLedger: FullHistoryLedgerSequence;
	readonly lastLedger: FullHistoryLedgerSequence;
}

export interface FullHistoryLedgerRangeView {
	readonly records: readonly FullHistoryCanonicalLedgerView[];
}

export function validateFullHistoryLedgerRangeQuery(
	query: FullHistoryLedgerRangeQuery
): void {
	const firstLedger = fullHistoryLedgerSequence(
		query.firstLedger,
		'firstLedger'
	);
	const lastLedger = fullHistoryLedgerSequence(query.lastLedger, 'lastLedger');
	const inclusiveCount = BigInt(lastLedger) - BigInt(firstLedger) + 1n;
	if (inclusiveCount < 1n) {
		throw new RangeError('firstLedger must not exceed lastLedger');
	}
	if (inclusiveCount > BigInt(FULL_HISTORY_LEDGER_RANGE_LIMIT_MAX)) {
		throw new RangeError(
			`Ledger ranges must contain at most ${FULL_HISTORY_LEDGER_RANGE_LIMIT_MAX} ledgers`
		);
	}
}
