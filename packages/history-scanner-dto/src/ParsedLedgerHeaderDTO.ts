import { err, ok, Result } from 'neverthrow';

export interface ParsedLedgerHeaderDTO {
	readonly bucketListHash: string;
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
		return (
			typeof json === 'object' &&
			json !== null &&
			this.isNonEmptyString(json.sourceArchiveUrl) &&
			this.isNonEmptyString(json.scanJobRemoteId) &&
			typeof json.observedAt === 'string' &&
			!Number.isNaN(new Date(json.observedAt).getTime()) &&
			Array.isArray(json.headers) &&
			json.headers.every((header) => this.isValidHeader(header))
		);
	}

	private static isValidHeader(
		header: unknown
	): header is ParsedLedgerHeaderDTO {
		if (typeof header !== 'object' || header === null) return false;

		const candidate = header as Record<string, unknown>;
		return (
			this.isNonNegativeInteger(candidate.ledgerSequence) &&
			this.isNonNegativeInteger(candidate.protocolVersion) &&
			this.isNonEmptyString(candidate.ledgerHeaderHash) &&
			this.isNonEmptyString(candidate.previousLedgerHeaderHash) &&
			this.isNonEmptyString(candidate.transactionSetHash) &&
			this.isNonEmptyString(candidate.transactionResultHash) &&
			this.isNonEmptyString(candidate.bucketListHash)
		);
	}

	private static isNonNegativeInteger(value: unknown): value is number {
		return typeof value === 'number' && Number.isInteger(value) && value >= 0;
	}

	private static isNonEmptyString(value: unknown): value is string {
		return typeof value === 'string' && value.trim().length > 0;
	}
}

interface ParsedLedgerHeaderBatchJSON extends Record<string, unknown> {
	readonly headers: readonly ParsedLedgerHeaderDTO[];
	readonly observedAt: string;
	readonly scanJobRemoteId: string;
	readonly sourceArchiveUrl: string;
}
