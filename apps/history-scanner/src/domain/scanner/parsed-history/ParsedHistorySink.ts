export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonObject
	| readonly JsonValue[];

export interface JsonObject {
	readonly [key: string]: JsonValue;
}

export interface ParsedLedgerHeaderRecord extends JsonObject {
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

export type ParsedHistoryRecord = ParsedLedgerHeaderRecord;

export interface ParsedHistorySink {
	emit(record: ParsedHistoryRecord): void | Promise<void>;
}

export const noopParsedHistorySink: ParsedHistorySink = {
	emit: () => undefined
};
