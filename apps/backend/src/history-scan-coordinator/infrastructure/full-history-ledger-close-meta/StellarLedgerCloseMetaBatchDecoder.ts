import { createHash } from 'node:crypto';
import { zstdDecompressSync } from 'node:zlib';
import { xdr } from '@stellar/stellar-sdk';
import {
	fullHistoryLedgerCloseMetaDecodeLimits,
	fullHistoryLedgerCloseMetaRange,
	fullHistoryLedgerCloseMetaSequence,
	fullHistoryLedgerCloseMetaSha256Digest,
	type FullHistoryDecodedLedgerCloseMeta,
	type FullHistoryDecodedLedgerCloseMetaBatch,
	type FullHistoryLedgerCloseMetaDecodeLimits,
	type FullHistoryLedgerCloseMetaDecodeRequest,
	type FullHistoryLedgerCloseMetaVersion,
	FullHistoryLedgerCloseMetaValidationError
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type { FullHistoryLedgerCloseMetaBatchDecoderPort } from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaPorts.js';

export class StellarLedgerCloseMetaBatchDecoder implements FullHistoryLedgerCloseMetaBatchDecoderPort {
	readonly #limits: FullHistoryLedgerCloseMetaDecodeLimits;

	constructor(limits: FullHistoryLedgerCloseMetaDecodeLimits) {
		this.#limits = fullHistoryLedgerCloseMetaDecodeLimits(
			limits.maximumCompressedBytes,
			limits.maximumUncompressedBytes
		);
	}

	decode(
		request: FullHistoryLedgerCloseMetaDecodeRequest
	): FullHistoryDecodedLedgerCloseMetaBatch {
		if (!(request.compressedPayload instanceof Uint8Array)) {
			throw new FullHistoryLedgerCloseMetaValidationError(
				'invalid-source-payload',
				'Compressed ledger-close-meta payload must be bytes'
			);
		}
		const expectedRange = fullHistoryLedgerCloseMetaRange(
			request.expectedRange.startSequence,
			request.expectedRange.endSequence
		);
		const compressed = Buffer.from(request.compressedPayload);
		if (compressed.byteLength > this.#limits.maximumCompressedBytes) {
			throw new FullHistoryLedgerCloseMetaValidationError(
				'compressed-byte-limit-exceeded',
				'Compressed ledger-close-meta batch exceeds its byte limit'
			);
		}

		const compressedSha256 = sha256(compressed);
		const xdrBytes = this.#decompress(compressed);
		const xdrSha256 = sha256(xdrBytes);
		const batch = this.#decodeXdr(xdrBytes);
		const decodedRange = fullHistoryLedgerCloseMetaRange(
			batch.startSequence(),
			batch.endSequence()
		);
		const ledgerCloseMetas = batch.ledgerCloseMeta();
		if (ledgerCloseMetas.length === 0) {
			throw new FullHistoryLedgerCloseMetaValidationError(
				'empty-batch',
				'Ledger-close-meta batch must contain at least one ledger'
			);
		}
		if (ledgerCloseMetas.length !== decodedRange.ledgerCount) {
			throw new FullHistoryLedgerCloseMetaValidationError(
				'batch-cardinality-mismatch',
				'Ledger-close-meta count does not match its inclusive range'
			);
		}
		if (
			decodedRange.startSequence !== expectedRange.startSequence ||
			decodedRange.endSequence !== expectedRange.endSequence
		) {
			throw new FullHistoryLedgerCloseMetaValidationError(
				'batch-range-mismatch',
				'Decoded ledger-close-meta range does not match the requested range'
			);
		}

		const ledgers = Object.freeze(
			ledgerCloseMetas.map((ledgerCloseMeta, index) =>
				decodeLedger(ledgerCloseMeta, decodedRange.startSequence + index)
			)
		);
		return Object.freeze({
			compressedByteCount: compressed.byteLength,
			compressedSha256,
			ledgers,
			range: decodedRange,
			xdrByteCount: xdrBytes.byteLength,
			xdrSha256
		});
	}

	#decompress(compressed: Buffer): Buffer {
		try {
			const decoded = zstdDecompressSync(compressed, {
				maxOutputLength: this.#limits.maximumUncompressedBytes
			});
			if (decoded.byteLength > this.#limits.maximumUncompressedBytes) {
				throw new FullHistoryLedgerCloseMetaValidationError(
					'uncompressed-byte-limit-exceeded',
					'Ledger-close-meta XDR exceeds its uncompressed byte limit'
				);
			}
			return decoded;
		} catch (error) {
			if (error instanceof FullHistoryLedgerCloseMetaValidationError)
				throw error;
			if (errorCode(error) === 'ERR_BUFFER_TOO_LARGE') {
				throw new FullHistoryLedgerCloseMetaValidationError(
					'uncompressed-byte-limit-exceeded',
					'Ledger-close-meta XDR exceeds its uncompressed byte limit',
					{ cause: error }
				);
			}
			throw new FullHistoryLedgerCloseMetaValidationError(
				'zstd-decode-failed',
				'Ledger-close-meta payload is not valid Zstandard data',
				{ cause: error }
			);
		}
	}

	#decodeXdr(bytes: Buffer): xdr.LedgerCloseMetaBatch {
		try {
			return xdr.LedgerCloseMetaBatch.fromXDR(bytes);
		} catch (error) {
			throw new FullHistoryLedgerCloseMetaValidationError(
				'xdr-decode-failed',
				'Payload is not one complete LedgerCloseMetaBatch XDR value',
				{ cause: error }
			);
		}
	}
}

function decodeLedger(
	ledgerCloseMeta: xdr.LedgerCloseMeta,
	expectedSequence: number
): FullHistoryDecodedLedgerCloseMeta {
	const version = ledgerCloseMetaVersion(ledgerCloseMeta);
	const sequence = fullHistoryLedgerCloseMetaSequence(
		ledgerHeader(ledgerCloseMeta, version).header().ledgerSeq()
	);
	if (sequence !== expectedSequence) {
		throw new FullHistoryLedgerCloseMetaValidationError(
			'batch-sequence-discontinuity',
			`Ledger-close-meta sequence ${sequence} does not match expected sequence ${expectedSequence}`
		);
	}
	return Object.freeze({ ledgerCloseMeta, sequence, version });
}

function ledgerCloseMetaVersion(
	ledgerCloseMeta: xdr.LedgerCloseMeta
): FullHistoryLedgerCloseMetaVersion {
	const version = ledgerCloseMeta.switch();
	if (version === 0 || version === 1 || version === 2) return version;
	throw new FullHistoryLedgerCloseMetaValidationError(
		'unsupported-ledger-close-meta-version',
		`LedgerCloseMeta version ${version} is not supported`
	);
}

function ledgerHeader(
	ledgerCloseMeta: xdr.LedgerCloseMeta,
	version: FullHistoryLedgerCloseMetaVersion
): xdr.LedgerHeaderHistoryEntry {
	switch (version) {
		case 0:
			return ledgerCloseMeta.v0().ledgerHeader();
		case 1:
			return ledgerCloseMeta.v1().ledgerHeader();
		case 2:
			return ledgerCloseMeta.v2().ledgerHeader();
	}
}

function sha256(value: Uint8Array) {
	return fullHistoryLedgerCloseMetaSha256Digest(
		createHash('sha256').update(value).digest('hex')
	);
}

function errorCode(error: unknown): string | undefined {
	if (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		typeof error.code === 'string'
	) {
		return error.code;
	}
	return undefined;
}
