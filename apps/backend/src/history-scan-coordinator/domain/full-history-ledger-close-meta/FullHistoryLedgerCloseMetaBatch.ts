import { xdr } from '@stellar/stellar-sdk';

export const STELLAR_LEDGER_SEQUENCE_MAX = 0xffff_ffff;

declare const ledgerSequenceBrand: unique symbol;
declare const sha256DigestBrand: unique symbol;

export type FullHistoryLedgerCloseMetaSequence = number & {
	readonly [ledgerSequenceBrand]: true;
};

export type FullHistoryLedgerCloseMetaSha256Digest = string & {
	readonly [sha256DigestBrand]: true;
};

export type FullHistoryLedgerCloseMetaVersion = 0 | 1 | 2;

export type FullHistoryLedgerCloseMetaValidationErrorReason =
	| 'batch-cardinality-mismatch'
	| 'batch-range-mismatch'
	| 'batch-sequence-discontinuity'
	| 'compressed-byte-limit-exceeded'
	| 'empty-batch'
	| 'invalid-decode-limit'
	| 'invalid-ledger-sequence'
	| 'invalid-ledgers-path'
	| 'invalid-source-config'
	| 'invalid-source-payload'
	| 'uncompressed-byte-limit-exceeded'
	| 'unsupported-ledger-close-meta-version'
	| 'xdr-decode-failed'
	| 'zstd-decode-failed';

export class FullHistoryLedgerCloseMetaValidationError extends Error {
	constructor(
		readonly reason: FullHistoryLedgerCloseMetaValidationErrorReason,
		message: string,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = 'FullHistoryLedgerCloseMetaValidationError';
	}
}

export interface FullHistoryLedgerCloseMetaRange {
	readonly endSequence: FullHistoryLedgerCloseMetaSequence;
	readonly ledgerCount: number;
	readonly startSequence: FullHistoryLedgerCloseMetaSequence;
}

export interface FullHistoryLedgerCloseMetaDecodeLimits {
	readonly maximumCompressedBytes: number;
	readonly maximumUncompressedBytes: number;
}

export interface FullHistoryLedgerCloseMetaDecodeRequest {
	readonly compressedPayload: Uint8Array;
	readonly expectedRange: FullHistoryLedgerCloseMetaRange;
}

export interface FullHistoryDecodedLedgerCloseMeta {
	readonly ledgerCloseMeta: xdr.LedgerCloseMeta;
	readonly sequence: FullHistoryLedgerCloseMetaSequence;
	readonly version: FullHistoryLedgerCloseMetaVersion;
}

export interface FullHistoryLedgerCloseMetaBatchEvidence {
	readonly compressedByteCount: number;
	readonly compressedSha256: FullHistoryLedgerCloseMetaSha256Digest;
	readonly range: FullHistoryLedgerCloseMetaRange;
	readonly xdrByteCount: number;
	readonly xdrSha256: FullHistoryLedgerCloseMetaSha256Digest;
}

export interface FullHistoryDecodedLedgerCloseMetaBatch extends FullHistoryLedgerCloseMetaBatchEvidence {
	readonly ledgers: readonly FullHistoryDecodedLedgerCloseMeta[];
}

export function fullHistoryLedgerCloseMetaSequence(
	value: number,
	field = 'ledgerSequence'
): FullHistoryLedgerCloseMetaSequence {
	if (
		!Number.isSafeInteger(value) ||
		value < 0 ||
		value > STELLAR_LEDGER_SEQUENCE_MAX
	) {
		throw new FullHistoryLedgerCloseMetaValidationError(
			'invalid-ledger-sequence',
			`${field} must be an unsigned 32-bit integer`
		);
	}
	return value as FullHistoryLedgerCloseMetaSequence;
}

export function fullHistoryLedgerCloseMetaRange(
	startSequence: number,
	endSequence: number
): FullHistoryLedgerCloseMetaRange {
	const start = fullHistoryLedgerCloseMetaSequence(
		startSequence,
		'startSequence'
	);
	const end = fullHistoryLedgerCloseMetaSequence(endSequence, 'endSequence');
	if (end < start) {
		throw new FullHistoryLedgerCloseMetaValidationError(
			'batch-range-mismatch',
			'endSequence must be greater than or equal to startSequence'
		);
	}
	return Object.freeze({
		endSequence: end,
		ledgerCount: end - start + 1,
		startSequence: start
	});
}

export function fullHistoryLedgerCloseMetaDecodeLimits(
	maximumCompressedBytes: number,
	maximumUncompressedBytes: number
): FullHistoryLedgerCloseMetaDecodeLimits {
	assertPositiveSafeInteger(maximumCompressedBytes, 'maximumCompressedBytes');
	assertPositiveSafeInteger(
		maximumUncompressedBytes,
		'maximumUncompressedBytes'
	);
	return Object.freeze({ maximumCompressedBytes, maximumUncompressedBytes });
}

export function fullHistoryLedgerCloseMetaSha256Digest(
	value: string
): FullHistoryLedgerCloseMetaSha256Digest {
	if (!/^[0-9a-f]{64}$/.test(value)) {
		throw new TypeError(
			'Ledger-close-meta SHA-256 digests must be 64 lowercase hexadecimal characters'
		);
	}
	return value as FullHistoryLedgerCloseMetaSha256Digest;
}

function assertPositiveSafeInteger(value: number, field: string): void {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new FullHistoryLedgerCloseMetaValidationError(
			'invalid-decode-limit',
			`${field} must be a positive safe integer`
		);
	}
}
