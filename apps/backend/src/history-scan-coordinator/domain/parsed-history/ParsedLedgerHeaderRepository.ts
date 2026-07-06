import type { ParsedLedgerHeaderBatchDTO } from 'history-scanner-dto';

export interface ParsedLedgerHeaderWatermark {
	readonly earliestLedgerSequence: number | null;
	readonly latestLedgerHeaderHash: string | null;
	readonly latestLedgerSequence: number | null;
	readonly latestObservedAt: Date | null;
	readonly parsedLedgerCount: number;
	readonly sourceArchiveCount: number;
}

export interface ParsedLedgerHeaderRepository {
	getWatermark(): Promise<ParsedLedgerHeaderWatermark>;
	saveBatch(batch: ParsedLedgerHeaderBatchDTO): Promise<void>;
}
