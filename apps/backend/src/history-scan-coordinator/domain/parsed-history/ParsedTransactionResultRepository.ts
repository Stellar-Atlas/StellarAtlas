import type { ParsedTransactionResultBatchDTO } from 'history-scanner-dto';

export interface ParsedTransactionResultDetails {
	readonly ledgerSequence: number;
	readonly lastSourceArchiveUrl: string;
	readonly resultXdr: string;
	readonly transactionHash: string;
	readonly transactionIndex: number;
	readonly transactionResultHash: string;
}

export interface ParsedTransactionResultRepository {
	findByTransactionHash(
		transactionHash: string
	): Promise<ParsedTransactionResultDetails | null>;
	saveBatch(batch: ParsedTransactionResultBatchDTO): Promise<void>;
}
