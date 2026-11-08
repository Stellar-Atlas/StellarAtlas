import {
	isFullHistoryCurrentCapacityAllowanceActive,
	parseFullHistoryCurrentCapacityAllowance
} from '../FullHistoryCurrentCapacityAllowance.js';

describe('FullHistoryCurrentCapacityAllowance', () => {
	const now = Date.parse('2026-11-08T12:00:00.000Z');
	const keys = {
		minimumLedger: 'FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_CAPACITY_MIN_LEDGER',
		reserveBorrowBytes:
			'FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_CAPACITY_RESERVE_BORROW_BYTES',
		expiresAt: 'FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_CAPACITY_EXPIRES_AT'
	} as const;

	it('is disabled when all settings are absent', () => {
		expect(parseFullHistoryCurrentCapacityAllowance({}, now)).toBeUndefined();
	});

	it('parses and freezes a complete allowance with its fixed expiry', () => {
		const allowance = parseFullHistoryCurrentCapacityAllowance(
			{
				[keys.minimumLedger]: '4294967295',
				[keys.reserveBorrowBytes]: '1099511627776',
				[keys.expiresAt]: '2026-11-08T18:00:00.000Z'
			},
			now
		);
		expect(allowance).toEqual({
			minimumLedger: 0xffff_ffff,
			maximumReserveBorrowBytes: 1024n ** 4n,
			expiresAtMilliseconds: Date.parse('2026-11-08T18:00:00.000Z')
		});
		expect(Object.isFrozen(allowance)).toBe(true);
		expect(isFullHistoryCurrentCapacityAllowanceActive(allowance, now)).toBe(true);
		expect(
			isFullHistoryCurrentCapacityAllowanceActive(
				allowance,
				allowance!.expiresAtMilliseconds
			)
		).toBe(false);
	});

	it('rejects partial, blank, non-decimal, and out-of-range settings', () => {
		expect(() =>
			parseFullHistoryCurrentCapacityAllowance({ [keys.minimumLedger]: '1' }, now)
		).toThrow(/fully configured/);
		expect(() =>
			parseFullHistoryCurrentCapacityAllowance(
				{
					[keys.minimumLedger]: '  ',
					[keys.reserveBorrowBytes]: '1',
					[keys.expiresAt]: '2026-11-08T13:00:00.000Z'
				},
				now
			)
		).toThrow(/fully configured/);
		for (const value of ['0', '01', '+1', '1.5', '4294967296']) {
			expect(() =>
				parseFullHistoryCurrentCapacityAllowance(
					{
						[keys.minimumLedger]: value,
						[keys.reserveBorrowBytes]: '1',
						[keys.expiresAt]: '2026-11-08T13:00:00.000Z'
					},
					now
				)
			).toThrow();
		}
		expect(() =>
			parseFullHistoryCurrentCapacityAllowance(
				{
					[keys.minimumLedger]: '1',
					[keys.reserveBorrowBytes]: '1099511627777',
					[keys.expiresAt]: '2026-11-08T13:00:00.000Z'
				},
				now
			)
		).toThrow(/range/);
	});

	it('accepts past expiry but rejects non-canonical timestamps and expiry beyond six hours', () => {
		const past = parseFullHistoryCurrentCapacityAllowance(
			{
				[keys.minimumLedger]: '1',
				[keys.reserveBorrowBytes]: '1',
				[keys.expiresAt]: '2026-11-08T11:00:00.000Z'
			},
			now
		);
		expect(isFullHistoryCurrentCapacityAllowanceActive(past, now)).toBe(false);
		for (const expiry of ['2026-11-08T18:00:00Z', '2026-11-08T18:00:00.001Z']) {
			expect(() =>
				parseFullHistoryCurrentCapacityAllowance(
					{
						[keys.minimumLedger]: '1',
						[keys.reserveBorrowBytes]: '1',
						[keys.expiresAt]: expiry
					},
					now
				)
			).toThrow();
		}
	});

	it('validates the injected clock', () => {
		expect(() => parseFullHistoryCurrentCapacityAllowance({}, -1)).toThrow(/nowMilliseconds/);
		expect(() => isFullHistoryCurrentCapacityAllowanceActive(undefined, Number.NaN)).toThrow(
			/nowMilliseconds/
		);
	});
});
