import {
	FULL_HISTORY_LEDGER_MAX,
	FULL_HISTORY_POSTGRES_BIGINT_MAX,
	fullHistoryLedgerSequence,
	fullHistoryUint64,
	FullHistoryHash
} from '../FullHistoryCanonicalTypes.js';

describe('full-history canonical value boundaries', () => {
	it('keeps uint64-like values as canonical decimal strings within bigint', () => {
		expect(fullHistoryUint64(FULL_HISTORY_POSTGRES_BIGINT_MAX)).toBe(
			'9223372036854775807'
		);
		expect(() =>
			fullHistoryUint64(FULL_HISTORY_POSTGRES_BIGINT_MAX + 1n)
		).toThrow(/bigint boundary/);
		expect(() => fullHistoryUint64('01')).toThrow(/canonical/);
		expect(() => fullHistoryUint64('-1')).toThrow(/canonical/);
	});

	it('enforces the Stellar ledger boundary separately', () => {
		expect(fullHistoryLedgerSequence(FULL_HISTORY_LEDGER_MAX)).toBe(
			'4294967295'
		);
		expect(() =>
			fullHistoryLedgerSequence(FULL_HISTORY_LEDGER_MAX + 1n)
		).toThrow(/ledger boundary/);
	});

	it('owns an immutable copy of every exact 32-byte hash', () => {
		const bytes = Buffer.alloc(32, 7);
		const hash = FullHistoryHash.fromBytes(bytes);
		bytes.fill(9);
		expect(hash.toHex()).toBe('07'.repeat(32));
		expect(() => FullHistoryHash.fromBytes(Buffer.alloc(31))).toThrow(
			/exactly 32 bytes/
		);
		expect(() => FullHistoryHash.fromHex('not-a-hash')).toThrow(/hexadecimal/);
	});
});
