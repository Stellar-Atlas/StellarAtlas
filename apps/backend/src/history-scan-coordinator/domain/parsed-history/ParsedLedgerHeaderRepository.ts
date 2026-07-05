import type { ParsedLedgerHeaderBatchDTO } from 'history-scanner-dto';

export interface ParsedLedgerHeaderRepository {
	saveBatch(batch: ParsedLedgerHeaderBatchDTO): Promise<void>;
}
