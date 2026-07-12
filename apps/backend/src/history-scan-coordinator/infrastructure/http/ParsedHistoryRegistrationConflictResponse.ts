import {
	ParsedLedgerHeaderConflictError,
	type ParsedLedgerHeaderConflictReason,
	type ParsedLedgerHeaderIdentity
} from '../../domain/parsed-history/ParsedLedgerHeaderConflictError.js';
import {
	ParsedTransactionConflictError,
	type ParsedTransactionConflictReason,
	type ParsedTransactionIdentity
} from '../../domain/parsed-history/ParsedTransactionConflictError.js';

export const parsedHistoryConflictCode = 'parsed_history_conflict';
const maximumConflictIdentities = 1_000;

export interface ParsedHistoryRegistrationConflictResponse {
	readonly error: {
		readonly code: typeof parsedHistoryConflictCode;
		readonly failureChannel: 'archive_evidence';
		readonly identities: readonly ParsedHistoryConflictIdentity[];
		readonly message: string;
		readonly reason: ParsedHistoryConflictReason;
	};
}

type ParsedHistoryConflictReason =
	ParsedLedgerHeaderConflictReason | ParsedTransactionConflictReason;

type ParsedHistoryConflictIdentity =
	ParsedLedgerHeaderIdentity | ParsedTransactionIdentity;

export function mapParsedHistoryRegistrationConflict(
	error: Error
): ParsedHistoryRegistrationConflictResponse | null {
	if (error instanceof ParsedLedgerHeaderConflictError) {
		return mapConflict(error, error.identities);
	}
	if (error instanceof ParsedTransactionConflictError) {
		return mapConflict(error, error.identities);
	}
	return null;
}

function mapConflict(
	error: ParsedLedgerHeaderConflictError | ParsedTransactionConflictError,
	identities: readonly ParsedHistoryConflictIdentity[]
): ParsedHistoryRegistrationConflictResponse | null {
	if (identities.length === 0 || identities.length > maximumConflictIdentities)
		return null;

	return {
		error: {
			code: parsedHistoryConflictCode,
			failureChannel: 'archive_evidence',
			identities: identities.map((identity) => ({ ...identity })),
			message: error.message,
			reason: error.reason
		}
	};
}
