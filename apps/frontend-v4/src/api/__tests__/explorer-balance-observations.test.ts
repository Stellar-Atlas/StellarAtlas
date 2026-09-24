import { jest } from '@jest/globals';
import {
	balanceObservationPath,
	fetchBalanceObservations,
	parseBalanceObservationPage
} from '../explorer-balance-observations';

const evidence = {
	watermark: {
		mode: 'latest-ingested-observations',
		snapshotPinned: false,
		catalogGeneratedAt: '2026-09-08T02:00:00Z',
		catalogMaximumLedger: '63490367'
	},
	coverage: {
		totalLedgerCount: '30000000',
		contiguousLastLedger: '29999937',
		gapCount: 1
	},
	nextCursor: 'opaque-next'
};
const balance = {
	asset: 'native',
	balance: 12.3456789,
	balanceRaw: null,
	amountPrecision: 'float64-observation',
	buyingLiabilities: 1,
	sellingLiabilities: 2,
	observedLedger: 63490364,
	lastModifiedLedger: 63490360,
	trustLineLimitRaw: null
};
const holder = {
	account_id: 'GA',
	balance: 12.3456789,
	buying_liabilities: 1,
	selling_liabilities: 2,
	ledger_sequence: 63490364,
	last_modified_ledger: 63490360,
	trust_line_limit: '9223372036854775807'
};

describe('explorer observed balances and holders', () => {
	it('uses existing bounded cursor routes without unsupported date/as-of/window parameters', () => {
		expect(balanceObservationPath('balances', 'GA', null)).toBe(
			'/v1/analytics/accounts/GA/balances?limit=25'
		);
		expect(balanceObservationPath('holders', 'USD:GA', 'opaque+cursor/')).toBe(
			'/v1/analytics/assets/USD%3AGA/holders?limit=25&after=opaque%2Bcursor%2F'
		);
	});
	it('preserves actual source precision, raw limits, observed ledger and partial coverage', () => {
		const balances = parseBalanceObservationPage('balances', 'GA', {
			...evidence,
			account: 'GA',
			balances: [balance]
		});
		expect(balances).toMatchObject({
			rows: [{ id: 'native', balance: 12.3456789, observedLedger: 63490364 }],
			gapCount: 1,
			totalLedgerCount: '30000000',
			nextCursor: 'opaque-next'
		});
		const holders = parseBalanceObservationPage('holders', 'USD:GA', {
			...evidence,
			asset: 'USD:GA',
			holders: [holder]
		});
		expect(holders.rows[0]?.trustLineLimit).toBe('9223372036854775807');
	});
	it('accepts an explicit empty observation page without treating it as current-chain absence', () => {
		expect(
			parseBalanceObservationPage('balances', 'GA', {
				...evidence,
				account: 'GA',
				balances: [],
				nextCursor: null
			})
		).toMatchObject({ rows: [], nextCursor: null, gapCount: 1 });
	});
	it('rejects missing evidence, wrong entity scope, malformed rows and unrecognized precision', () => {
		const valid = { ...evidence, account: 'GA', balances: [balance] };
		for (const invalid of [
			{ ...valid, watermark: undefined },
			{ ...valid, coverage: {} },
			{ ...valid, account: 'GB' },
			{ ...valid, balances: undefined },
			{ ...valid, nextCursor: undefined },
			{ ...valid, watermark: { ...evidence.watermark, snapshotPinned: true } },
			{ ...valid, balances: [{ ...balance, amountPrecision: 'exact' }] },
			{ ...valid, balances: [{ ...balance, balance: Infinity }] },
			{ ...valid, balances: [{ ...balance, observedLedger: 'unsafe' }] }
		])
			expect(() =>
				parseBalanceObservationPage('balances', 'GA', invalid)
			).toThrow('invalid balance observation');
	});
	it('forwards the cursor and abort signal and does not turn HTTP503 into an empty page', async () => {
		const originalFetch = globalThis.fetch;
		const signal = new AbortController().signal;
		const calls: { path: string; signal: unknown }[] = [];
		globalThis.fetch = async (input, options) => {
			calls.push({ path: String(input), signal: options?.signal });
			return new Response(
				JSON.stringify({
					code: 'hubble_warehouse_unavailable',
					error: 'Unavailable'
				}),
				{ status: 503 }
			);
		};
		try {
			await expect(
				fetchBalanceObservations('holders', 'native', 'GA', signal)
			).rejects.toThrow('HTTP 503');
			expect(calls).toEqual([
				{
					path: '/v1/analytics/assets/native/holders?limit=25&after=GA',
					signal
				}
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
	it('rejects a server cursor that repeats the requested page', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async () =>
			new Response(
				JSON.stringify({ ...evidence, account: 'GA', balances: [balance] })
			);
		try {
			await expect(
				fetchBalanceObservations(
					'balances',
					'GA',
					'opaque-next',
					new AbortController().signal
				)
			).rejects.toThrow('invalid balance observation');
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
