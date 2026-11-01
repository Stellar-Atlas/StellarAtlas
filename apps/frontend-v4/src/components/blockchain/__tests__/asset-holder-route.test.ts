import { holderRouteHref, readHolderRoute } from '../asset-holder-route';

describe('holder URL state', () => {
	it('restores each sort, zero mode and an opaque cursor without number coercion', () => {
		for (const sort of ['balance-desc', 'balance-asc', 'account-asc', 'account-desc']) {
			const route = readHolderRoute(new URLSearchParams({ holder_sort: sort, holder_zero: '1', holder_after: 'opaque+cursor/==' }));
			expect(route).toEqual({ sort, includeZero: true, after: 'opaque+cursor/==' });
		}
	});
	it('rejects malformed options/cursors and ambiguous duplicate parameters', () => {
		for (const query of ['holder_sort=wrong&holder_after=c', 'holder_zero=true&holder_after=c', 'holder_after=c&holder_after=d', 'holder_after=%00x', 'holder_after=' + 'x'.repeat(4097)])
			expect(readHolderRoute(new URLSearchParams(query)).after).toBeNull();
		expect(readHolderRoute(new URLSearchParams())).toEqual({ sort: 'balance-desc', includeZero: false, after: null });
	});
	it('preserves asset tab, unrelated event cursor, return context and hash while resetting holder continuation', () => {
		const href = holderRouteHref('/explorer/assets/native', '?tab=holders&after=event&holder_after=old&return_to=%2Fexplorer', { sort: 'account-asc', includeZero: true, after: null }, '#holders');
		const url = new URL(href, 'https://explorer.invalid');
		expect(url.searchParams.get('tab')).toBe('holders');
		expect(url.searchParams.get('after')).toBe('event');
		expect(url.searchParams.has('holder_after')).toBe(false);
		expect(url.searchParams.get('holder_sort')).toBe('account-asc');
		expect(url.searchParams.get('holder_zero')).toBe('1');
		expect(url.searchParams.get('return_to')).toBe('/explorer');
		expect(url.hash).toBe('#holders');
	});
});
