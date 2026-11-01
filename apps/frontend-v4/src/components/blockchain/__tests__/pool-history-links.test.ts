import { hasPoolHistory, poolContextFromRequest, poolDetailHref, poolListHref } from '../pool-history-links';
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
});
