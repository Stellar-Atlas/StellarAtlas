import { poolBrowserHref, readPoolBrowserRoute, type PoolBrowserRoute } from '../pool-browser-route';

const current: PoolBrowserRoute = { filters: { asset: 'native' }, sort: 'shares', order: 'asc', limit: '50', historical: false, position: 'opaque+/=' };
describe('pool list URL selection', () => {
	it('round-trips scoped latest sort, rows and opaque cursor, rejecting changed resource/options', () => {
		const url = new URL(poolBrowserHref('/explorer/liquidity-pools', '?return_to=%2Fexplorer', current, false, '#pools'), 'http://fixture.invalid');
		expect(readPoolBrowserRoute(url.searchParams, {}, 0, false)).toEqual(current);
		url.searchParams.set('pool_rows', '25');
		expect(readPoolBrowserRoute(url.searchParams, {}, 0, false).position).toBe('');
		url.searchParams.set('asset', 'different');
		expect(readPoolBrowserRoute(url.searchParams, {}, 0, false).position).toBe('');
		expect(url.searchParams.get('return_to')).toBe('/explorer');
		expect(url.hash).toBe('#pools');
	});
	it('restores legacy historical bounds/offset, and never treats current cursors as offsets', () => {
		const route = readPoolBrowserRoute(new URLSearchParams('min_ledger=100&max_ledger=200&offset=50&limit=10'), {}, 50, false);
		expect(route).toMatchObject({ historical: true, position: '50', limit: '10', filters: { min_ledger: '100', max_ledger: '200' } });
		const url = new URL(poolBrowserHref('/explorer/liquidity-pools', '', route, false), 'http://fixture.invalid');
		expect(url.searchParams.has('pool_after')).toBe(false);
		expect(readPoolBrowserRoute(url.searchParams, {}, 0, false)).toEqual(route);
	});
	it('keeps embedded pool state separate from parent activity/trade parameters', () => {
		const url = new URL(poolBrowserHref('/explorer/assets/native', '?tab=markets&min_ledger=900&max_ledger=999&offset=50&market_trade_min=100&after=event', current, true), 'http://fixture.invalid');
		expect(readPoolBrowserRoute(url.searchParams, {}, 0, true, 'native')).toEqual(current);
		expect(url.searchParams.get('min_ledger')).toBe('900');
		expect(url.searchParams.get('offset')).toBe('50');
		expect(url.searchParams.get('after')).toBe('event');
		expect(url.searchParams.get('market_trade_min')).toBe('100');
	});
	it('bounds malformed, repeated and oversized control values to a first page', () => {
		for (const query of ['pool_rows=100000', 'pool_sort=unknown', 'pool_order=asc&pool_order=desc', 'pool_mode=other', 'pool_after=' + 'x'.repeat(4097)]) {
			const route = readPoolBrowserRoute(new URLSearchParams(query), {}, 0, false);
			expect(route.position).toBe('');
			expect(Number(route.limit)).toBeLessThanOrEqual(100);
		}
		expect(readPoolBrowserRoute(new URLSearchParams('pool_mode=history&pool_offset=10001'), {}, 0, false).position).toBe('');
	});
});
