import { createHash } from 'node:crypto';
import { zstdCompressSync } from 'node:zlib';
import {
	fullHistoryLedgerCloseMetaDecodeLimits,
	fullHistoryLedgerCloseMetaRange,
	FullHistoryLedgerCloseMetaValidationError,
	type FullHistoryLedgerCloseMetaVersion
} from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import { StellarLedgerCloseMetaBatchDecoder } from '../StellarLedgerCloseMetaBatchDecoder.js';
import { ledgerCloseMetaBatchFixture } from './LedgerCloseMetaBatchTestFixture.js';

const generousLimits = fullHistoryLedgerCloseMetaDecodeLimits(
	64 * 1024,
	256 * 1024
);

describe('StellarLedgerCloseMetaBatchDecoder', () => {
	it.each([0, 1, 2] as const)(
		'decodes and validates LedgerCloseMeta V%i',
		(version) => {
			const fixture = ledgerCloseMetaBatchFixture(2, 2, [2], [version]);
			const decoded = decoder().decode({
				compressedPayload: fixture.compressed,
				expectedRange: fullHistoryLedgerCloseMetaRange(2, 2)
			});

			expect(decoded.range).toEqual({
				endSequence: 2,
				ledgerCount: 1,
				startSequence: 2
			});
			expect(
				decoded.ledgers.map(({ sequence, version }) => ({ sequence, version }))
			).toEqual([{ sequence: 2, version }]);
			expect(decoded.compressedByteCount).toBe(fixture.compressed.byteLength);
			expect(decoded.xdrByteCount).toBe(fixture.xdrBytes.byteLength);
			expect(decoded.compressedSha256).toBe(sha256(fixture.compressed));
			expect(decoded.xdrSha256).toBe(sha256(fixture.xdrBytes));
		}
	);

	it('accepts a contiguous mixed-version inclusive batch', () => {
		const versions: readonly FullHistoryLedgerCloseMetaVersion[] = [0, 1, 2];
		const fixture = ledgerCloseMetaBatchFixture(2, 4, [2, 3, 4], versions);
		const decoded = decoder().decode({
			compressedPayload: fixture.compressed,
			expectedRange: fullHistoryLedgerCloseMetaRange(2, 4)
		});
		expect(decoded.ledgers.map((ledger) => ledger.sequence)).toEqual([2, 3, 4]);
		expect(decoded.ledgers.map((ledger) => ledger.version)).toEqual(versions);
	});

	it('separates malformed Zstandard data from malformed batch XDR', () => {
		expectReason(
			() =>
				decoder().decode({
					compressedPayload: Buffer.from('not-zstd'),
					expectedRange: fullHistoryLedgerCloseMetaRange(2, 2)
				}),
			'zstd-decode-failed'
		);
		expectReason(
			() =>
				decoder().decode({
					compressedPayload: zstdCompressSync(Buffer.from('not-xdr')),
					expectedRange: fullHistoryLedgerCloseMetaRange(2, 2)
				}),
			'xdr-decode-failed'
		);
	});

	it('rejects a decoded range different from the requested object range', () => {
		const fixture = ledgerCloseMetaBatchFixture(3, 3, [3]);
		expectReason(
			() =>
				decoder().decode({
					compressedPayload: fixture.compressed,
					expectedRange: fullHistoryLedgerCloseMetaRange(2, 2)
				}),
			'batch-range-mismatch'
		);
	});

	it('rejects empty, cardinality-mismatched, and discontinuous batches', () => {
		const cases = [
			{
				fixture: ledgerCloseMetaBatchFixture(2, 2, []),
				reason: 'empty-batch'
			},
			{
				fixture: ledgerCloseMetaBatchFixture(2, 3, [2]),
				reason: 'batch-cardinality-mismatch'
			},
			{
				fixture: ledgerCloseMetaBatchFixture(2, 3, [2, 4]),
				reason: 'batch-sequence-discontinuity'
			}
		] as const;
		for (const testCase of cases) {
			expectReason(
				() =>
					decoder().decode({
						compressedPayload: testCase.fixture.compressed,
						expectedRange: fullHistoryLedgerCloseMetaRange(2, 3)
					}),
				testCase.reason
			);
		}
	});

	it('enforces compressed and uncompressed limits independently', () => {
		const fixture = ledgerCloseMetaBatchFixture(2, 2, [2]);
		expectReason(
			() =>
				new StellarLedgerCloseMetaBatchDecoder(
					fullHistoryLedgerCloseMetaDecodeLimits(
						fixture.compressed.byteLength - 1,
						fixture.xdrBytes.byteLength
					)
				).decode({
					compressedPayload: fixture.compressed,
					expectedRange: fullHistoryLedgerCloseMetaRange(2, 2)
				}),
			'compressed-byte-limit-exceeded'
		);
		expectReason(
			() =>
				new StellarLedgerCloseMetaBatchDecoder(
					fullHistoryLedgerCloseMetaDecodeLimits(
						fixture.compressed.byteLength,
						fixture.xdrBytes.byteLength - 1
					)
				).decode({
					compressedPayload: fixture.compressed,
					expectedRange: fullHistoryLedgerCloseMetaRange(2, 2)
				}),
			'uncompressed-byte-limit-exceeded'
		);
	});
});

function decoder(): StellarLedgerCloseMetaBatchDecoder {
	return new StellarLedgerCloseMetaBatchDecoder(generousLimits);
}

function sha256(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

function expectReason(
	action: () => unknown,
	reason: FullHistoryLedgerCloseMetaValidationError['reason']
): void {
	try {
		action();
		throw new Error(`Expected ${reason}`);
	} catch (error) {
		expect(error).toBeInstanceOf(FullHistoryLedgerCloseMetaValidationError);
		expect((error as FullHistoryLedgerCloseMetaValidationError).reason).toBe(
			reason
		);
	}
}
