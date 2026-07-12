import { err, ok, Result } from 'neverthrow';

const maximumBatchSize = 1_000;
const maximumLedgerSequence = 0xffff_ffff;
const maximumTransactionIndex = 0x7fff_ffff;

export interface ParsedTransactionEnvelopeDTO {
	readonly envelopeXdr: string;
	readonly ledgerSequence: number;
	readonly transactionIndex: number;
	readonly transactionSetHash: string;
}

export interface ParsedTransactionResultDTO {
	readonly ledgerSequence: number;
	readonly resultXdr: string;
	readonly transactionHash: string;
	readonly transactionIndex: number;
	readonly transactionResultHash: string;
}

abstract class ParsedTransactionBatchDTO<RecordType> {
	constructor(
		public readonly sourceArchiveUrl: string,
		public readonly scanJobRemoteId: string,
		public readonly observedAt: Date,
		public readonly records: readonly RecordType[]
	) {}
}

export class ParsedTransactionEnvelopeBatchDTO extends ParsedTransactionBatchDTO<ParsedTransactionEnvelopeDTO> {
	static fromJSON(
		json: Record<string, unknown>
	): Result<ParsedTransactionEnvelopeBatchDTO, Error> {
		if (!this.isValidBatchJSON(json, this.isValidEnvelope)) {
			return err(
				new Error('Invalid ParsedTransactionEnvelopeBatchDTO JSON format')
			);
		}

		return ok(
			new ParsedTransactionEnvelopeBatchDTO(
				json.sourceArchiveUrl,
				json.scanJobRemoteId,
				new Date(json.observedAt),
				json.records
			)
		);
	}

	private static isValidEnvelope(
		record: unknown
	): record is ParsedTransactionEnvelopeDTO {
		if (typeof record !== 'object' || record === null) return false;
		const candidate = record as Record<string, unknown>;
		return (
			isIntegerInRange(candidate.ledgerSequence, maximumLedgerSequence) &&
			isIntegerInRange(candidate.transactionIndex, maximumTransactionIndex) &&
			isNonEmptyString(candidate.transactionSetHash) &&
			isNonEmptyString(candidate.envelopeXdr)
		);
	}

	private static isValidBatchJSON(
		json: Record<string, unknown>,
		isValidRecord: (record: unknown) => boolean
	): json is ParsedTransactionEnvelopeBatchJSON {
		return isValidBatch(json, isValidRecord);
	}
}

export class ParsedTransactionResultBatchDTO extends ParsedTransactionBatchDTO<ParsedTransactionResultDTO> {
	static fromJSON(
		json: Record<string, unknown>
	): Result<ParsedTransactionResultBatchDTO, Error> {
		if (!this.isValidBatchJSON(json, this.isValidResult)) {
			return err(
				new Error('Invalid ParsedTransactionResultBatchDTO JSON format')
			);
		}

		return ok(
			new ParsedTransactionResultBatchDTO(
				json.sourceArchiveUrl,
				json.scanJobRemoteId,
				new Date(json.observedAt),
				json.records
			)
		);
	}

	private static isValidResult(
		record: unknown
	): record is ParsedTransactionResultDTO {
		if (typeof record !== 'object' || record === null) return false;
		const candidate = record as Record<string, unknown>;
		return (
			isIntegerInRange(candidate.ledgerSequence, maximumLedgerSequence) &&
			isIntegerInRange(candidate.transactionIndex, maximumTransactionIndex) &&
			isNonEmptyString(candidate.transactionResultHash) &&
			isNonEmptyString(candidate.transactionHash) &&
			isNonEmptyString(candidate.resultXdr)
		);
	}

	private static isValidBatchJSON(
		json: Record<string, unknown>,
		isValidRecord: (record: unknown) => boolean
	): json is ParsedTransactionResultBatchJSON {
		return isValidBatch(json, isValidRecord);
	}
}

interface ParsedTransactionEnvelopeBatchJSON extends Record<string, unknown> {
	readonly records: readonly ParsedTransactionEnvelopeDTO[];
	readonly observedAt: string;
	readonly scanJobRemoteId: string;
	readonly sourceArchiveUrl: string;
}

interface ParsedTransactionResultBatchJSON extends Record<string, unknown> {
	readonly records: readonly ParsedTransactionResultDTO[];
	readonly observedAt: string;
	readonly scanJobRemoteId: string;
	readonly sourceArchiveUrl: string;
}

function isValidBatch(
	json: Record<string, unknown>,
	isValidRecord: (record: unknown) => boolean
): boolean {
	if (!(
		typeof json === 'object' &&
		json !== null &&
		isNonEmptyString(json.sourceArchiveUrl) &&
		isNonEmptyString(json.scanJobRemoteId) &&
		typeof json.observedAt === 'string' &&
		isCanonicalTimestamp(json.observedAt) &&
		Array.isArray(json.records) &&
		json.records.length <= maximumBatchSize &&
		json.records.every(isValidRecord)
	)) {
		return false;
	}

	return true;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function isIntegerInRange(value: unknown, maximum: number): value is number {
	return (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value >= 0 &&
		value <= maximum
	);
}

function isCanonicalTimestamp(value: string): boolean {
	const parsed = new Date(value);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
