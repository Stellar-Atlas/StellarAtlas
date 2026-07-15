import type { FullHistoryLedgerProjection } from '../../domain/full-history-state-import/FullHistoryLedgerProjection.js';

type JsonRecord = Readonly<Record<string, unknown>>;

const exactKeys = [
	'bucketListHash',
	'closedAtUnixMillis',
	'ledgerHash',
	'ledgerSequence',
	'previousLedgerHash',
	'protocolVersion',
	'transactionCount',
	'transactionResultSetHash',
	'transactionSetHash'
] as const;

export function parseFullHistoryLedgerProjection(
	value: unknown
): FullHistoryLedgerProjection {
	const row = readRecord(value);
	assertExactKeys(row);
	return Object.freeze({
		bucketListHash: readHash(row, 'bucketListHash'),
		closedAtUnixMillis: readDecimal(
			row,
			'closedAtUnixMillis',
			0n,
			8_640_000_000_000_000n
		),
		ledgerHash: readHash(row, 'ledgerHash'),
		ledgerSequence: readDecimal(row, 'ledgerSequence', 1n, 4_294_967_295n),
		previousLedgerHash: readHash(row, 'previousLedgerHash'),
		protocolVersion: readInteger(row, 'protocolVersion', 1, 2_147_483_647),
		transactionCount: readDecimal(row, 'transactionCount', 0n, 2_147_483_647n),
		transactionResultSetHash: readHash(row, 'transactionResultSetHash'),
		transactionSetHash: readHash(row, 'transactionSetHash')
	});
}

function readRecord(value: unknown): JsonRecord {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError('Ledger projection must be an object');
	}
	return value as JsonRecord;
}

function assertExactKeys(row: JsonRecord): void {
	const actual = Object.keys(row).sort();
	const expected = [...exactKeys].sort();
	if (
		actual.length !== expected.length ||
		actual.some((key, index) => key !== expected[index])
	) {
		throw new TypeError('Ledger projection has an unexpected field set');
	}
}

function readHash(row: JsonRecord, key: string): string {
	const value = row[key];
	if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
		throw new TypeError(`${key} must be a lowercase SHA-256 value`);
	}
	return value;
}

function readDecimal(
	row: JsonRecord,
	key: string,
	minimum: bigint,
	maximum: bigint
): string {
	const value = row[key];
	if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
		throw new TypeError(`${key} must be a canonical decimal string`);
	}
	const parsed = BigInt(value);
	if (parsed < minimum || parsed > maximum) {
		throw new TypeError(`${key} is outside its supported range`);
	}
	return value;
}

function readInteger(
	row: JsonRecord,
	key: string,
	minimum: number,
	maximum: number
): number {
	const value = row[key];
	if (
		typeof value !== 'number' ||
		!Number.isInteger(value) ||
		value < minimum ||
		value > maximum
	) {
		throw new TypeError(`${key} is outside its supported integer range`);
	}
	return value;
}
