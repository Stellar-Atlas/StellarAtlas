import { hasPoolHistory, poolContextFromRequest, poolDetailHref, poolListHref, poolPairReportHref } from '../pool-history-links';
import { withExplorerReturnTo } from '../../../api/explorer-return-context';

describe('pool historical links', () => {
	it('preserves supported explicit history and existing return context, not paging/sort arguments', () => {
		const context = poolContextFromRequest('/v1/liquidity-pools?min_ledger=100&max_ledger=200&deleted=false&offset=50&order_by=shares&limit=25');
		const href = withExplorerReturnTo(poolDetailHref('pool-id', context), '/explorer/liquidity-pools?min_ledger=100&max_ledger=200&offset=50');
		const url = new URL(href, 'https://explorer.invalid');
		expect(url.searchParams.get('min_ledger')).toBe('100');
		expect(url.searchParams.get('max_ledger')).toBe('200');
		expect(url.searchParams.get('deleted')).toBe('false');
		for (const key of ['offset', 'after', 'order_by', 'limit']) expect(url.searchParams.has(key)).toBe(false);
		expect(url.searchParams.get('return_to')).toContain('offset=50');
		expect(poolListHref(context)).toContain('min_ledger=100&max_ledger=200');
	});
	it('retains time selection; only implicit historical windows use actual returned bounds', () => {
		const timed = poolContextFromRequest('?start_time=2026-01-01T00%3A00%3A00Z&end_time=2026-01-02T00%3A00%3A00Z', { minLedger: 1, maxLedger: 10 });
		expect(timed.start_time).toBe('2026-01-01T00:00:00Z');
		expect(timed.min_ledger).toBeUndefined();
		expect(poolContextFromRequest('?offset=50', { minLedger: 100, maxLedger: 163 })).toEqual({ min_ledger: '100', max_ledger: '163' });
		expect(poolContextFromRequest('?offset=50', { minLedger: 'not-a-ledger', maxLedger: 163 })).toEqual({});
		expect(poolContextFromRequest('?offset=50', { minLedger: true, maxLedger: 163 })).toEqual({});
	});
	it('keeps latest links current and does not classify deleted-only filtering as historical', () => {
		expect(poolDetailHref('pool-id')).toBe('/explorer/liquidity-pools/pool-id');
		expect(hasPoolHistory({ deleted: 'false' })).toBe(false);
		expect(poolListHref({ after: 'opaque', order: 'desc' })).toBe('/explorer/liquidity-pools');
	});
	it('opens only known asset pairs with the accepted pool range and exact return controls', () => {
		const counter = 'USD:G' + 'A'.repeat(55);
		const origin = '/explorer/assets/native?tab=markets&market_view=liquidity-pools&pool_mode=history&pool_offset=25';
		const latest = new URL(poolPairReportHref('native', counter, 'native', origin)!, 'https://explorer.invalid');
		expect(latest.searchParams.get('asset_a')).toBe('native');
		expect(latest.searchParams.get('asset_b')).toBe(counter);
		expect(latest.searchParams.get('min_ledger')).toBe('');
		const historical = new URL(poolPairReportHref('native', 'native', counter, origin, { minLedger: 100, maxLedger: 150 })!, latest);
		expect(historical.searchParams.get('min_ledger')).toBe('100');
		expect(historical.searchParams.get('max_ledger')).toBe('150');
		expect(historical.searchParams.get('return_to')).toBe(origin);
		expect(poolPairReportHref('native', 'native', counter, origin, { minLedger: 100, maxLedger: 2148 })).toBeNull();
		expect(poolPairReportHref('native', 'native', counter, origin, {})).toBeNull();
		expect(poolPairReportHref('native', counter, 'EUR:G' + 'B'.repeat(55), origin)).toBeNull();
	});
});
