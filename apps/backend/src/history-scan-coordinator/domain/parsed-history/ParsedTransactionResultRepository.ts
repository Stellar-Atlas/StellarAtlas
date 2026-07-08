import type { ParsedTransactionResultBatchDTO } from 'history-scanner-dto';

export interface ParsedTransactionResultDetails {
	readonly ledgerSequence: number;
	readonly lastSourceArchiveUrl: string;
	readonly resultXdr: string;
	readonly transactionHash: string;
	readonly transactionIndex: number;
	readonly transactionResultHash: string;
}

export interface ParsedRecentTransactionDetails {
	readonly envelopeObservedAt: Date | null;
	readonly envelopeSourceArchiveUrl: string | null;
	readonly headerObservedAt: Date | null;
	readonly headerSourceArchiveUrl: string | null;
	readonly ledgerHeaderHash: string | null;
	readonly ledgerSequence: number;
	readonly protocolVersion: number | null;
	readonly resultObservedAt: Date;
	readonly resultSourceArchiveUrl: string;
	readonly transactionHash: string;
	readonly transactionIndex: number;
	readonly transactionResultHash: string;
	readonly transactionSetHash: string | null;
}

export interface ParsedTransactionResultRepository {
	findByTransactionHash(
		transactionHash: string
	): Promise<ParsedTransactionResultDetails | null>;
	findRecentWithLedgerContext(
		limit: number
	): Promise<ParsedRecentTransactionDetails[]>;
	saveBatch(batch: ParsedTransactionResultBatchDTO): Promise<void>;
}
