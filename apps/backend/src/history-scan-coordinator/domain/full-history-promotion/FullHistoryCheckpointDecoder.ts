import type {
	FullHistoryLedgerInput,
	FullHistoryTransactionInput,
	FullHistoryTransactionResultInput
} from '../full-history/FullHistoryCanonicalBatch.js';
import type { FullHistoryOperationInput } from '../full-history/FullHistoryCanonicalOperation.js';
import type { FullHistoryOperationAccountReferenceInput } from '../full-history/FullHistoryCanonicalOperationAccountReference.js';
import type { FullHistoryOperationResultInput } from '../full-history/FullHistoryCanonicalOperationResult.js';
import type { FullHistoryCheckpointCandidate } from './FullHistoryCheckpointCandidate.js';

export interface FullHistoryDecodedCheckpoint {
	readonly ledgers: readonly FullHistoryLedgerInput[];
	readonly operationAccountReferences: readonly FullHistoryOperationAccountReferenceInput[];
	readonly operations: readonly FullHistoryOperationInput[];
	readonly operationResults: readonly FullHistoryOperationResultInput[];
	readonly results: readonly FullHistoryTransactionResultInput[];
	readonly transactions: readonly FullHistoryTransactionInput[];
}

export interface FullHistoryCheckpointDecoder {
	readonly version: string;
	readonly operationAccountReferenceDecoderVersion: string;
	readonly operationDecoderVersion: string;
	readonly operationResultDecoderVersion: string;
	decode(
		candidate: FullHistoryCheckpointCandidate,
		networkPassphrase: string
	): Promise<FullHistoryDecodedCheckpoint>;
}
