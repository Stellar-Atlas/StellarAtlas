import type {
	FullHistoryLedgerInput,
	FullHistoryTransactionInput,
	FullHistoryTransactionResultInput
} from '../full-history/FullHistoryCanonicalBatch.js';
import type { FullHistoryOperationInput } from '../full-history/FullHistoryCanonicalOperation.js';
import type { FullHistoryCheckpointCandidate } from './FullHistoryCheckpointCandidate.js';

export interface FullHistoryDecodedCheckpoint {
	readonly ledgers: readonly FullHistoryLedgerInput[];
	readonly operations: readonly FullHistoryOperationInput[];
	readonly results: readonly FullHistoryTransactionResultInput[];
	readonly transactions: readonly FullHistoryTransactionInput[];
}

export interface FullHistoryCheckpointDecoder {
	readonly version: string;
	decode(
		candidate: FullHistoryCheckpointCandidate,
		networkPassphrase: string
	): Promise<FullHistoryDecodedCheckpoint>;
}
