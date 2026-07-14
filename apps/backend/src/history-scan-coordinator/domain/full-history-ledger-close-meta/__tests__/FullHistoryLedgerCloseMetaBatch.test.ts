import {
	fullHistoryLedgerCloseMetaDecodeLimits,
	fullHistoryLedgerCloseMetaRange,
	fullHistoryLedgerCloseMetaSequence,
	fullHistoryLedgerCloseMetaSha256Digest,
	STELLAR_LEDGER_SEQUENCE_MAX
} from '../FullHistoryLedgerCloseMetaBatch.js';

describe('full-history ledger-close-meta batch contracts', () => {
	it('accepts the complete uint32 ledger sequence domain', () => {
		expect(fullHistoryLedgerCloseMetaSequence(0)).toBe(0);
		expect(
			fullHistoryLedgerCloseMetaSequence(STELLAR_LEDGER_SEQUENCE_MAX)
		).toBe(STELLAR_LEDGER_SEQUENCE_MAX);
		for (const invalid of [
			-1,
			1.5,
			STELLAR_LEDGER_SEQUENCE_MAX + 1,
			Number.MAX_SAFE_INTEGER + 1
		]) {
			expect(() => fullHistoryLedgerCloseMetaSequence(invalid)).toThrow(
				/unsigned 32-bit integer/
			);
		}
	});

	it('models inclusive nonempty ranges and their cardinality', () => {
		expect(fullHistoryLedgerCloseMetaRange(2, 4)).toEqual({
			endSequence: 4,
			ledgerCount: 3,
			startSequence: 2
		});
		expect(fullHistoryLedgerCloseMetaRange(9, 9).ledgerCount).toBe(1);
		expect(() => fullHistoryLedgerCloseMetaRange(4, 3)).toThrow(/endSequence/);
	});

	it('requires explicit positive safe byte limits', () => {
		expect(fullHistoryLedgerCloseMetaDecodeLimits(1024, 4096)).toEqual({
			maximumCompressedBytes: 1024,
			maximumUncompressedBytes: 4096
		});
		for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
			expect(() => fullHistoryLedgerCloseMetaDecodeLimits(invalid, 1)).toThrow(
				/positive safe integer/
			);
			expect(() => fullHistoryLedgerCloseMetaDecodeLimits(1, invalid)).toThrow(
				/positive safe integer/
			);
		}
	});

	it('accepts only canonical lowercase SHA-256 digests', () => {
		expect(fullHistoryLedgerCloseMetaSha256Digest('ab'.repeat(32))).toBe(
			'ab'.repeat(32)
		);
		for (const invalid of ['ab', 'AB'.repeat(32), 'gg'.repeat(32)]) {
			expect(() => fullHistoryLedgerCloseMetaSha256Digest(invalid)).toThrow(
				/lowercase hexadecimal/
			);
		}
	});
});
