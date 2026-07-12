import type {
	FullHistoryCheckpointWrite,
	FullHistoryEnvelopeType
} from './FullHistoryCanonicalBatch.js';
import type {
	FullHistoryHash,
	FullHistoryLedgerSequence,
	FullHistoryUint64String
} from './FullHistoryCanonicalTypes.js';

export interface FullHistoryWriteReceipt {
	readonly batchId: string;
	readonly nextLedger: FullHistoryUint64String;
	readonly replayed: boolean;
}

export interface FullHistoryWatermarkView {
	readonly lastBatchId: string;
	readonly nextLedger: FullHistoryUint64String;
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

export interface FullHistoryCanonicalRepository {
	findLedger(
		networkPassphrase: string,
		ledgerSequence: FullHistoryLedgerSequence
	): Promise<FullHistoryLedgerView | null>;
	findTransaction(
		networkPassphrase: string,
		transactionHash: FullHistoryHash
	): Promise<FullHistoryTransactionView | null>;
	getWatermark(
		networkPassphrase: string
	): Promise<FullHistoryWatermarkView | null>;
	writeCheckpoint(
		input: FullHistoryCheckpointWrite
	): Promise<FullHistoryWriteReceipt>;
}
