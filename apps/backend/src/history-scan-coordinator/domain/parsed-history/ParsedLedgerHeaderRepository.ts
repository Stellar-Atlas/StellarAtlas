import type { ParsedLedgerHeaderBatchDTO } from 'history-scanner-dto';

export interface ParsedLedgerHeaderWatermark {
	readonly earliestLedgerSequence: number | null;
	readonly latestLedgerHeaderHash: string | null;
	readonly latestLedgerSequence: number | null;
	readonly latestObservedAt: Date | null;
	readonly parsedLedgerCount: number;
	readonly sourceArchiveCount: number;
}

export interface ParsedLedgerHeaderDetails {
	readonly bucketListHash: string;
	readonly ledgerHeaderHash: string;
	readonly lastSourceArchiveUrl: string;
	readonly protocolVersion: number;
	readonly transactionResultHash: string;
	readonly transactionSetHash: string;
}

export interface ParsedLedgerHeaderSourceRange {
	readonly archiveUrl: string;
	readonly earliestLedgerSequence: number;
	readonly latestLedgerSequence: number;
	readonly latestObservedAt: Date;
	readonly parsedLedgerCount: number;
}

export interface ParsedLedgerHeaderRepository {
	findByLedgerSequence(
		ledgerSequence: number
	): Promise<ParsedLedgerHeaderDetails | null>;
	findSourceRanges(limit: number): Promise<ParsedLedgerHeaderSourceRange[]>;
	getWatermark(): Promise<ParsedLedgerHeaderWatermark>;
	saveBatch(batch: ParsedLedgerHeaderBatchDTO): Promise<void>;
}
