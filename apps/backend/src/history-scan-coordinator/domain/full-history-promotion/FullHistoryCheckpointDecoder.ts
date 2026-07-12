import type {
	FullHistoryLedgerInput,
	FullHistoryTransactionInput,
	FullHistoryTransactionResultInput
} from '../full-history/FullHistoryCanonicalBatch.js';
import type { FullHistoryCheckpointCandidate } from './FullHistoryCheckpointCandidate.js';

export interface FullHistoryDecodedCheckpoint {
	readonly ledgers: readonly FullHistoryLedgerInput[];
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
