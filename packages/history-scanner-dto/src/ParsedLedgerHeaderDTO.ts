import { err, ok, Result } from 'neverthrow';

const maximumBatchSize = 1_000;
const maximumLedgerSequence = 0xffff_ffff;
const maximumProtocolVersion = 0x7fff_ffff;

export interface ParsedLedgerHeaderDTO {
	readonly bucketListHash: string;
	readonly closedAt?: string | null;
	readonly ledgerHeaderHash: string;
	readonly ledgerSequence: number;
	readonly previousLedgerHeaderHash: string;
	readonly protocolVersion: number;
	readonly transactionResultHash: string;
	readonly transactionSetHash: string;
}

export class ParsedLedgerHeaderBatchDTO {
	constructor(
		public readonly sourceArchiveUrl: string,
		public readonly scanJobRemoteId: string,
		public readonly observedAt: Date,
		public readonly headers: readonly ParsedLedgerHeaderDTO[]
	) {}

	static fromJSON(
		json: Record<string, unknown>
	): Result<ParsedLedgerHeaderBatchDTO, Error> {
		if (!this.isValidBatchJSON(json)) {
			return err(new Error('Invalid ParsedLedgerHeaderBatchDTO JSON format'));
		}

		return ok(
			new ParsedLedgerHeaderBatchDTO(
				json.sourceArchiveUrl,
				json.scanJobRemoteId,
				new Date(json.observedAt),
				json.headers
			)
		);
	}

	private static isValidBatchJSON(
		json: Record<string, unknown>
	): json is ParsedLedgerHeaderBatchJSON {
		if (
			typeof json !== 'object' ||
			json === null ||
			!this.isNonEmptyString(json.sourceArchiveUrl) ||
			!this.isNonEmptyString(json.scanJobRemoteId) ||
			typeof json.observedAt !== 'string' ||
			Number.isNaN(new Date(json.observedAt).getTime()) ||
			!Array.isArray(json.headers) ||
			json.headers.length > maximumBatchSize ||
			!json.headers.every((header) => this.isValidHeader(header))
		) {
			return false;
		}

		return true;
	}

	private static isValidHeader(
		header: unknown
	): header is ParsedLedgerHeaderDTO {
		if (typeof header !== 'object' || header === null) return false;

		const candidate = header as Record<string, unknown>;
		return (
			this.isIntegerInRange(candidate.ledgerSequence, maximumLedgerSequence) &&
			this.isIntegerInRange(
				candidate.protocolVersion,
				maximumProtocolVersion
			) &&
			this.isCompatibleClosedAt(candidate.closedAt) &&
			this.isNonEmptyString(candidate.ledgerHeaderHash) &&
			this.isNonEmptyString(candidate.previousLedgerHeaderHash) &&
			this.isNonEmptyString(candidate.transactionSetHash) &&
			this.isNonEmptyString(candidate.transactionResultHash) &&
			this.isNonEmptyString(candidate.bucketListHash)
		);
	}

	private static isIntegerInRange(
		value: unknown,
		maximum: number
	): value is number {
		return (
			typeof value === 'number' &&
			Number.isSafeInteger(value) &&
			value >= 0 &&
			value <= maximum
		);
	}

	private static isNonEmptyString(value: unknown): value is string {
		return typeof value === 'string' && value.trim().length > 0;
	}

	private static isCompatibleClosedAt(
		value: unknown
	): value is string | null | undefined {
		if (value === undefined || value === null) return true;
		if (typeof value !== 'string') return false;

		const parsed = new Date(value);
		return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
	}
}

interface ParsedLedgerHeaderBatchJSON extends Record<string, unknown> {
	readonly headers: readonly ParsedLedgerHeaderDTO[];
	readonly observedAt: string;
	readonly scanJobRemoteId: string;
	readonly sourceArchiveUrl: string;
}
