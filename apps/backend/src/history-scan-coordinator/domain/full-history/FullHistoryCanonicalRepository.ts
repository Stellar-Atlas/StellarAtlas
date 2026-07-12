import type {
	FullHistoryCheckpointWrite,
	FullHistoryEnvelopeType
} from './FullHistoryCanonicalBatch.js';
import type {
	FullHistoryHash,
	FullHistoryLedgerSequence,
	FullHistoryUint64String
} from './FullHistoryCanonicalTypes.js';

export const FULL_HISTORY_RECENT_TRANSACTION_LIMIT_MAX = 50;

export interface FullHistoryWriteReceipt {
	readonly batchId: string;
	readonly nextLedger: FullHistoryUint64String;
	readonly replayed: boolean;
}

export interface FullHistoryPrependReceipt {
	readonly batchId: string;
	readonly firstLedger: FullHistoryLedgerSequence;
	readonly nextLedger: FullHistoryUint64String;
	readonly replayed: boolean;
}

export interface FullHistoryWatermarkView {
	readonly lastBatchId: string;
	readonly nextLedger: FullHistoryUint64String;
	readonly updatedAt: Date;
}

export interface FullHistoryCanonicalCoverageView {
	readonly archiveSourceCount: number;
	readonly batchCount: number;
	readonly firstLedger: FullHistoryLedgerSequence;
	readonly lastLedger: FullHistoryLedgerSequence;
	readonly latestLedgerClosedAt: Date;
	readonly ledgerCount: number;
	readonly nextLedger: FullHistoryUint64String;
	readonly transactionCount: number;
	readonly transactionResultCount: number;
	readonly updatedAt: Date;
}

export interface FullHistoryLedgerView {
	readonly bucketListHash: FullHistoryHash;
	readonly closedAt: Date;
	readonly ledgerHash: FullHistoryHash;
	readonly ledgerSequence: FullHistoryLedgerSequence;
	readonly previousLedgerHash: FullHistoryHash;
	readonly protocolVersion: number;
	readonly transactionCount: number;
	readonly transactionResultHash: FullHistoryHash;
	readonly transactionSetHash: FullHistoryHash;
}

export interface FullHistoryTransactionView {
	readonly closedAt: Date;
	readonly envelopeType: FullHistoryEnvelopeType;
	readonly feeBid: FullHistoryUint64String;
	readonly feeCharged: FullHistoryUint64String;
	readonly ledgerSequence: FullHistoryLedgerSequence;
	readonly operationCount: number;
	readonly operationResultCount: number;
	readonly resultCode: number;
	readonly sourceAccount: string;
	readonly sourceAccountSequence: FullHistoryUint64String;
	readonly successful: boolean;
	readonly transactionHash: FullHistoryHash;
	readonly transactionIndex: number;
}

export interface FullHistoryRecentTransactionsView {
	readonly records: readonly FullHistoryTransactionView[];
	readonly truncated: boolean;
}

export interface FullHistoryCanonicalRepository {
	findLedger(
		networkPassphrase: string,
		ledgerSequence: FullHistoryLedgerSequence
	): Promise<FullHistoryLedgerView | null>;
	findRecentTransactions(
		networkPassphrase: string,
		limit: number
	): Promise<FullHistoryRecentTransactionsView>;
	findTransaction(
		networkPassphrase: string,
		transactionHash: FullHistoryHash
	): Promise<FullHistoryTransactionView | null>;
	getCoverage(
		networkPassphrase: string
	): Promise<FullHistoryCanonicalCoverageView | null>;
	getWatermark(
		networkPassphrase: string
	): Promise<FullHistoryWatermarkView | null>;
	prependCheckpoint(
		input: FullHistoryCheckpointWrite
	): Promise<FullHistoryPrependReceipt>;
	writeCheckpoint(
		input: FullHistoryCheckpointWrite
	): Promise<FullHistoryWriteReceipt>;
}
