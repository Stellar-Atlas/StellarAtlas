import type { FullHistoryCheckpointWrite } from '../full-history/FullHistoryCanonicalBatch.js';
import type { FullHistoryOperationBackfillBatch } from './FullHistoryOperationBackfill.js';

export interface FullHistoryOperationBackfillReceipt {
	readonly batchId: string;
	readonly operationCount: number;
	readonly replayed: boolean;
}

export interface FullHistoryOperationBackfillRepository {
	findUnindexedBatches(
		networkPassphrase: string,
		limit: number
	): Promise<readonly FullHistoryOperationBackfillBatch[]>;
	storeOperations(
		input: FullHistoryCheckpointWrite
	): Promise<FullHistoryOperationBackfillReceipt>;
}
