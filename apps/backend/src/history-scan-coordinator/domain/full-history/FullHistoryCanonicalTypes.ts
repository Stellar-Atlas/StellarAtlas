import { createHash } from 'node:crypto';
import type { ValueTransformer } from 'typeorm';

const canonicalDecimalPattern = /^(0|[1-9][0-9]*)$/;
const hashHexPattern = /^[0-9a-f]{64}$/;
const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const FULL_HISTORY_POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
export const FULL_HISTORY_LEDGER_MAX = 4_294_967_295n;

declare const uint64Brand: unique symbol;
declare const ledgerSequenceBrand: unique symbol;

export type FullHistoryUint64String = string & {
	readonly [uint64Brand]: true;
};

export type FullHistoryLedgerSequence = FullHistoryUint64String & {
	readonly [ledgerSequenceBrand]: true;
};

export class FullHistoryHash {
	readonly #bytes: Buffer;

	private constructor(bytes: Buffer) {
		this.#bytes = bytes;
		Object.freeze(this);
	}

	static fromBytes(value: Uint8Array): FullHistoryHash {
		if (value.byteLength !== 32) {
			throw new RangeError('Full-history hashes must contain exactly 32 bytes');
		}
		return new FullHistoryHash(Buffer.from(value));
	}

	static fromHex(value: string): FullHistoryHash {
		const normalized = value.toLowerCase();
		if (!hashHexPattern.test(normalized)) {
			throw new Error('Full-history hashes must be 64 hexadecimal characters');
		}
		return FullHistoryHash.fromBytes(Buffer.from(normalized, 'hex'));
	}

	equals(other: FullHistoryHash): boolean {
		return this.#bytes.equals(other.#bytes);
	}

	toBuffer(): Buffer {
		return Buffer.from(this.#bytes);
	}

	toHex(): string {
		return this.#bytes.toString('hex');
	}
}

export function fullHistoryUint64(
	value: string | bigint,
	field = 'value'
): FullHistoryUint64String {
	const normalized = typeof value === 'bigint' ? value.toString() : value;
	if (!canonicalDecimalPattern.test(normalized)) {
		throw new Error(`${field} must be a canonical unsigned decimal string`);
	}
	const parsed = BigInt(normalized);
	if (parsed > FULL_HISTORY_POSTGRES_BIGINT_MAX) {
		throw new RangeError(`${field} exceeds the PostgreSQL bigint boundary`);
	}
	return normalized as FullHistoryUint64String;
}

export function fullHistoryLedgerSequence(
	value: string | bigint,
	field = 'ledgerSequence'
): FullHistoryLedgerSequence {
	const normalized = fullHistoryUint64(value, field);
	if (BigInt(normalized) > FULL_HISTORY_LEDGER_MAX) {
		throw new RangeError(`${field} exceeds the Stellar ledger boundary`);
	}
	return normalized as FullHistoryLedgerSequence;
}

export function incrementLedgerSequence(
	value: FullHistoryLedgerSequence
): FullHistoryUint64String {
	return fullHistoryUint64(BigInt(value) + 1n, 'nextLedger');
}

export function hashNetworkPassphrase(passphrase: string): FullHistoryHash {
	assertBoundedText(passphrase, 'networkPassphrase', 1_024);
	return FullHistoryHash.fromBytes(
		createHash('sha256').update(passphrase, 'utf8').digest()
	);
}

export function assertBoundedText(
	value: string,
	field: string,
	maximumLength: number
): string {
	if (value.trim().length === 0) throw new Error(`${field} must not be empty`);
	if (Buffer.byteLength(value, 'utf8') > maximumLength) {
		throw new RangeError(`${field} exceeds ${maximumLength} bytes`);
	}
	return value;
}

export function assertUuid(value: string, field: string): string {
	if (!uuidPattern.test(value)) throw new Error(`${field} must be a UUID`);
	return value.toLowerCase();
}

export function assertValidDate(value: Date, field: string): Date {
	if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
		throw new Error(`${field} must be a valid date`);
	}
	return value;
}

export function assertInteger(
	value: number,
	field: string,
	minimum: number,
	maximum = 0x7fff_ffff
): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`${field} is outside its supported integer range`);
	}
	return value;
}

export const fullHistoryUint64Transformer: ValueTransformer = {
	from: (value: unknown): FullHistoryUint64String => {
		if (typeof value !== 'string' && typeof value !== 'bigint') {
			throw new TypeError(
				'PostgreSQL returned a non-bigint full-history value'
			);
		}
		return fullHistoryUint64(value);
	},
	to: (value: FullHistoryUint64String): string => fullHistoryUint64(value)
};

export const fullHistoryLedgerTransformer: ValueTransformer = {
	from: (value: unknown): FullHistoryLedgerSequence => {
		if (typeof value !== 'string' && typeof value !== 'bigint') {
			throw new TypeError('PostgreSQL returned a non-bigint ledger sequence');
		}
		return fullHistoryLedgerSequence(value);
	},
	to: (value: FullHistoryLedgerSequence): string =>
		fullHistoryLedgerSequence(value)
};

export const fullHistoryHashTransformer: ValueTransformer = {
	from: (value: unknown): FullHistoryHash => {
		if (!(value instanceof Uint8Array)) {
			throw new TypeError('PostgreSQL returned a non-bytea full-history hash');
		}
		return FullHistoryHash.fromBytes(value);
	},
	to: (value: FullHistoryHash): Buffer => value.toBuffer()
};
