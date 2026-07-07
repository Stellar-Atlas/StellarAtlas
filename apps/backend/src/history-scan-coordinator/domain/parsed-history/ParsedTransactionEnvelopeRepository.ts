import type { ParsedTransactionEnvelopeBatchDTO } from 'history-scanner-dto';

export interface ParsedTransactionEnvelopeDetails {
	readonly envelopeXdr: string;
	readonly ledgerSequence: number;
	readonly lastSourceArchiveUrl: string;
	readonly transactionIndex: number;
	readonly transactionSetHash: string;
}

export interface ParsedTransactionEnvelopeRepository {
	findByLedgerTransaction(
		ledgerSequence: number,
		transactionSetHash: string,
		transactionIndex: number
	): Promise<ParsedTransactionEnvelopeDetails | null>;
	saveBatch(batch: ParsedTransactionEnvelopeBatchDTO): Promise<void>;
}
