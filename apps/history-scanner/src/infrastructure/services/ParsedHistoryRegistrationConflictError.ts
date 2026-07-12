import { err, ok, type Result } from 'neverthrow';
import type { HttpError, HttpResponse } from 'http-helper';
import { CoordinatorServiceError } from './CoordinatorServiceError.js';

const parsedHistoryConflictCode = 'parsed_history_conflict';
const maximumConflictIdentities = 1_000;
const maximumLedgerSequence = 0xffff_ffff;

export type ParsedHistoryRegistrationConflictReason =
	'duplicate-batch-identity' | 'stored-value-conflict';

export interface ParsedLedgerHeaderConflictIdentity {
	readonly ledgerHeaderHash: string;
	readonly ledgerSequence: number;
}

export interface ParsedTransactionConflictIdentity {
	readonly category: 'envelope' | 'result';
	readonly categoryHash: string;
	readonly ledgerSequence: number;
	readonly transactionIndex: number;
}

export type ParsedHistoryRegistrationConflictIdentity =
	ParsedLedgerHeaderConflictIdentity | ParsedTransactionConflictIdentity;

export class ParsedHistoryRegistrationConflictError extends Error {
	readonly code = parsedHistoryConflictCode;
	readonly failureChannel = 'archive_evidence';

	constructor(
		message: string,
		public readonly reason: ParsedHistoryRegistrationConflictReason,
		public readonly identities: readonly ParsedHistoryRegistrationConflictIdentity[]
	) {
		super(message);
		this.name = 'ParsedHistoryRegistrationConflictError';
	}
}

export function parseParsedHistoryRegistrationConflict(
	value: unknown
): ParsedHistoryRegistrationConflictError | null {
	if (!isRecord(value) || !isRecord(value.error)) return null;

	const error = value.error;
	if (
		error.code !== parsedHistoryConflictCode ||
		error.failureChannel !== 'archive_evidence' ||
		!isNonEmptyString(error.message) ||
		!isConflictReason(error.reason) ||
		!Array.isArray(error.identities) ||
		error.identities.length === 0 ||
		error.identities.length > maximumConflictIdentities
	) {
		return null;
	}

	const identities: ParsedHistoryRegistrationConflictIdentity[] = [];
	for (const identity of error.identities) {
		const parsedIdentity = parseConflictIdentity(identity);
		if (parsedIdentity === null) return null;
		identities.push(parsedIdentity);
	}

	return new ParsedHistoryRegistrationConflictError(
		error.message,
		error.reason,
		identities
	);
}

export function mapParsedHistoryRegistrationResponse(
	response: Result<HttpResponse, HttpError>,
	errorMessage: string
): Result<void, Error> {
	if (response.isErr()) {
		const conflict =
			response.error.response?.status === 409
				? parseParsedHistoryRegistrationConflict(response.error.response.data)
				: null;
		return err(
			conflict ?? new CoordinatorServiceError(errorMessage, response.error)
		);
	}

	if (response.value.status === 409) {
		const conflict = parseParsedHistoryRegistrationConflict(
			response.value.data
		);
		if (conflict !== null) return err(conflict);
	}

	return response.value.status === 201
		? ok(undefined)
		: err(new CoordinatorServiceError(errorMessage));
}

function parseConflictIdentity(
	value: unknown
): ParsedHistoryRegistrationConflictIdentity | null {
	if (!isRecord(value) || !isLedgerSequence(value.ledgerSequence)) return null;
	if (isNonEmptyString(value.ledgerHeaderHash)) {
		return {
			ledgerHeaderHash: value.ledgerHeaderHash,
			ledgerSequence: value.ledgerSequence
		};
	}
	if (
		(value.category === 'envelope' || value.category === 'result') &&
		isNonEmptyString(value.categoryHash) &&
		isTransactionIndex(value.transactionIndex)
	) {
		return {
			category: value.category,
			categoryHash: value.categoryHash,
			ledgerSequence: value.ledgerSequence,
			transactionIndex: value.transactionIndex
		};
	}
	return null;
}

function isLedgerSequence(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value >= 0 &&
		value <= maximumLedgerSequence
	);
}

function isTransactionIndex(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value >= 0 &&
		value <= 0x7fff_ffff
	);
}

function isConflictReason(
	value: unknown
): value is ParsedHistoryRegistrationConflictReason {
	return (
		value === 'duplicate-batch-identity' || value === 'stored-value-conflict'
	);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
