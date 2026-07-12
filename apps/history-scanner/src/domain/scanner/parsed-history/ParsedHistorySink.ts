export type JsonValue =
	string | number | boolean | null | JsonObject | readonly JsonValue[];

export interface JsonObject {
	readonly [key: string]: JsonValue;
}

export interface ParsedLedgerHeaderRecord extends JsonObject {
	readonly closedAt: string;
	readonly recordType: 'ledger-header';
	readonly sourceUrl: string;
	readonly ledger: number;
	readonly protocolVersion: number;
	readonly ledgerHeaderHash: string;
	readonly previousLedgerHeaderHash: string;
	readonly transactionSetHash: string;
	readonly transactionResultSetHash: string;
	readonly bucketListHash: string;
}

export interface ParsedTransactionEnvelopeRecord extends JsonObject {
	readonly recordType: 'transaction-envelope';
	readonly sourceUrl: string;
	readonly ledger: number;
	readonly transactionIndex: number;
	readonly transactionSetHash: string;
	readonly envelopeXdr: string;
}

export interface ParsedTransactionResultRecord extends JsonObject {
	readonly recordType: 'transaction-result';
	readonly sourceUrl: string;
	readonly ledger: number;
	readonly transactionIndex: number;
	readonly transactionResultHash: string;
	readonly transactionHash: string;
	readonly resultXdr: string;
}

export type ParsedHistoryRecord =
	| ParsedLedgerHeaderRecord
	| ParsedTransactionEnvelopeRecord
	| ParsedTransactionResultRecord;

export interface ParsedHistorySink {
	emit(record: ParsedHistoryRecord): void | Promise<void>;
}

export const noopParsedHistorySink: ParsedHistorySink = {
	emit: () => undefined
};
