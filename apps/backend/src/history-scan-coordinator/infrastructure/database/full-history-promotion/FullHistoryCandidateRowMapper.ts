import type {
	FullHistoryCandidateEnvelope,
	FullHistoryCandidateLedger,
	FullHistoryCandidateResult
} from '../../../domain/full-history-promotion/FullHistoryCheckpointCandidate.js';
import { FullHistoryPromotionError } from '../../../domain/full-history-promotion/FullHistoryPromotionError.js';
import {
	assertBoundedText,
	assertInteger,
	assertValidDate,
	fullHistoryLedgerSequence,
	FullHistoryHash
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';

export interface FullHistoryCandidateLedgerRow {
	readonly bucketListHash: string;
	readonly closedAt: Date | string | null;
	readonly ledgerHeaderHash: string;
	readonly ledgerSequence: number | string;
	readonly previousLedgerHeaderHash: string;
	readonly protocolVersion: number | string;
	readonly transactionResultHash: string;
	readonly transactionSetHash: string;
}

export interface FullHistoryCandidateEnvelopeRow {
	readonly envelopeXdr: string;
	readonly ledgerSequence: number | string;
	readonly transactionIndex: number | string;
	readonly transactionSetHash: string;
}

export interface FullHistoryCandidateResultRow {
	readonly ledgerSequence: number | string;
	readonly resultXdr: string;
	readonly transactionHash: string;
	readonly transactionIndex: number | string;
	readonly transactionResultHash: string;
}

export function mapFullHistoryCandidateLedger(
	row: FullHistoryCandidateLedgerRow
): FullHistoryCandidateLedger {
	if (row.closedAt === null) {
		throw promotionError(
			'candidate-incomplete',
			'Exact ledger-object observation has no close time'
		);
	}
	return {
		bucketListHash: stagingHash(row.bucketListHash, 'bucketListHash'),
		closedAt: assertValidDate(new Date(row.closedAt), 'closedAt'),
		ledgerHash: stagingHash(row.ledgerHeaderHash, 'ledgerHeaderHash'),
		ledgerSequence: fullHistoryLedgerSequence(
			readFullHistoryDatabaseBigint(row.ledgerSequence)
		),
		previousLedgerHash: stagingHash(
			row.previousLedgerHeaderHash,
			'previousLedgerHeaderHash'
		),
		protocolVersion: toInteger(row.protocolVersion, 'protocolVersion'),
		transactionResultHash: stagingHash(
			row.transactionResultHash,
			'transactionResultHash'
		),
		transactionSetHash: stagingHash(
			row.transactionSetHash,
			'transactionSetHash'
		)
	};
}

export function mapFullHistoryCandidateEnvelope(
	row: FullHistoryCandidateEnvelopeRow
): FullHistoryCandidateEnvelope {
	return {
		envelopeXdr: assertBoundedText(row.envelopeXdr, 'envelopeXdr', 1_500_000),
		ledgerSequence: fullHistoryLedgerSequence(
			readFullHistoryDatabaseBigint(row.ledgerSequence)
		),
		transactionIndex: toInteger(row.transactionIndex, 'transactionIndex'),
		transactionSetHash: stagingHash(
			row.transactionSetHash,
			'transactionSetHash'
		)
	};
}

export function mapFullHistoryCandidateResult(
	row: FullHistoryCandidateResultRow
): FullHistoryCandidateResult {
	return {
		ledgerSequence: fullHistoryLedgerSequence(
			readFullHistoryDatabaseBigint(row.ledgerSequence)
		),
		resultXdr: assertBoundedText(row.resultXdr, 'resultXdr', 1_500_000),
		transactionHash: stagingHash(row.transactionHash, 'transactionHash'),
		transactionIndex: toInteger(row.transactionIndex, 'transactionIndex'),
		transactionResultHash: stagingHash(
			row.transactionResultHash,
			'transactionResultHash'
		)
	};
}

export function validateFullHistoryCandidateLedgerRange(
	ledgers: readonly FullHistoryCandidateLedger[],
	checkpointLedger: number
): void {
	const first = checkpointLedger === 63 ? 1 : checkpointLedger - 63;
	if (
		ledgers.some(
			(ledger, index) => BigInt(ledger.ledgerSequence) !== BigInt(first + index)
		)
	) {
		throw promotionError(
			'ledger-range-mismatch',
			'Observed ledger rows do not form the exact checkpoint range'
		);
	}
}

export function readFullHistoryDatabaseBigint(value: number | string): bigint {
	if (typeof value === 'number' && !Number.isSafeInteger(value)) {
		throw promotionError('candidate-incomplete', 'Unsafe staging bigint value');
	}
	try {
		return BigInt(value);
	} catch (error) {
		throw promotionError(
			'candidate-incomplete',
			'Malformed staging bigint value',
			error
		);
	}
}

function stagingHash(value: string, field: string): FullHistoryHash {
	const bytes = Buffer.from(value, 'base64');
	if (bytes.length !== 32 || bytes.toString('base64') !== value) {
		throw promotionError(
			'candidate-incomplete',
			`${field} is not a canonical 32-byte staging hash`
		);
	}
	return FullHistoryHash.fromBytes(bytes);
}

function toInteger(value: number | string, field: string): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	return assertInteger(parsed, field, 0);
}

function promotionError(
	reason: ConstructorParameters<typeof FullHistoryPromotionError>[0],
	message: string,
	cause?: unknown
): FullHistoryPromotionError {
	return new FullHistoryPromotionError(reason, message, { cause });
}
