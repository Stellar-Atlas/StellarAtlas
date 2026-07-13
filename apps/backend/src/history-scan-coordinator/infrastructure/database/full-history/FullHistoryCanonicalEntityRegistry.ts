import { FullHistoryIngestionBatch } from './entities/FullHistoryIngestionBatch.js';
import { FullHistoryLedger } from './entities/FullHistoryLedger.js';
import { FullHistoryOperation } from './entities/FullHistoryOperation.js';
import { FullHistoryOperationResult } from './entities/FullHistoryOperationResult.js';
import { FullHistoryTransaction } from './entities/FullHistoryTransaction.js';
import { FullHistoryTransactionResult } from './entities/FullHistoryTransactionResult.js';
import { FullHistoryWatermark } from './entities/FullHistoryWatermark.js';

export const fullHistoryCanonicalEntities = [
	FullHistoryIngestionBatch,
	FullHistoryLedger,
	FullHistoryOperation,
	FullHistoryOperationResult,
	FullHistoryTransaction,
	FullHistoryTransactionResult,
	FullHistoryWatermark
] as const;
