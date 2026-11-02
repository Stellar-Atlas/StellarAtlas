import { assetMarketRouteHref, assetTradeSideHref, defaultAssetMarketRoute, readAssetMarketRoute } from '../asset-market-route';

describe('asset market URL state', () => {
	it('continues each trade side independently with a bounded page, accepted range and safe asset return', () => {
		const origin = '/explorer/assets/native?tab=markets&market_trade_min=99&market_trade_max=101&return_to=%2Fexplorer';
		for (const side of ['sell', 'buy'] as const) {
			const url = new URL(assetTradeSideHref('native', side, { minLedger: 99, maxLedger: 101 }, origin), 'https://explorer.invalid');
			expect(url.pathname).toBe('/explorer/trades');
			expect(url.searchParams.get(side === 'sell' ? 'selling_asset' : 'buying_asset')).toBe('native');
			expect(url.searchParams.has(side === 'sell' ? 'buying_asset' : 'selling_asset')).toBe(false);
			expect(url.searchParams.get('limit')).toBe('25');
			expect(url.searchParams.get('min_ledger')).toBe('99');
			expect(url.searchParams.get('max_ledger')).toBe('101');
			expect(url.searchParams.has('offset')).toBe(false);
			expect(url.searchParams.get('return_to')).toBe(origin.split('&return_to=')[0]);
		}
		expect(assetTradeSideHref('native', 'sell', { minLedger: 99, maxLedger: 101 }, 'https://untrusted.invalid/')).not.toContain('return_to');
	});
	it('pins the return window to accepted results while preserving safe asset and tab context', () => {
		const origin = '/explorer/assets/USD%3AGISSUER?tab=markets&market_trade_min=2&market_trade_max=98&holder_cursor=next&return_to=%2Fexplorer#ignored';
		for (const side of ['sell', 'buy'] as const) {
			const browse = new URL(assetTradeSideHref('USD:GISSUER', side, { minLedger: 99, maxLedger: 101 }, origin), 'https://explorer.invalid');
			const back = new URL(browse.searchParams.get('return_to')!, 'https://explorer.invalid');
			expect(back.pathname).toBe('/explorer/assets/USD%3AGISSUER');
			expect(back.searchParams.get('tab')).toBe('markets');
			expect(back.searchParams.get('holder_cursor')).toBe('next');
			expect(back.searchParams.getAll('market_trade_min')).toEqual(['99']);
			expect(back.searchParams.getAll('market_trade_max')).toEqual(['101']);
			expect(back.searchParams.has('return_to')).toBe(false);
			expect(back.hash).toBe('');
		}
		for (const origin of ['//outside.invalid/', 'javascript:alert(1)', '/explorer?x=%0a', '/explorer?x=%Q'])
			expect(new URL(assetTradeSideHref('native', 'sell', { minLedger: 99, maxLedger: 101 }, origin), 'https://explorer.invalid').searchParams.has('return_to')).toBe(false);
	});
	it('restores the view and bounded explicit trade window, including newer-than-identity history', () => {
		expect(readAssetMarketRoute(new URLSearchParams('market_view=liquidity-pools&market_trade_min=2000&market_trade_max=3000'), 1000))
			.toEqual({ view: 'liquidity-pools', min: '2000', max: '3000' });
		expect(defaultAssetMarketRoute(2049)).toEqual({ view: 'trades', min: '2', max: '2049' });
	});
	it('never forwards malformed, partial, reversed, repeated or excessive ranges', () => {
		for (const query of ['market_trade_min=-1&market_trade_max=10', 'market_trade_min=2', 'market_trade_min=20&market_trade_max=10', 'market_trade_min=2&market_trade_max=2050', 'market_trade_min=2&market_trade_max=4294967296', 'market_trade_min=2&market_trade_max=3&market_trade_max=4', 'market_view=unknown'])
			expect(readAssetMarketRoute(new URLSearchParams(query), 1000)).toEqual(defaultAssetMarketRoute(1000));
	});
	it('preserves asset tab, other continuation, return context and hash; latest removes only trade bounds', () => {
		const href = assetMarketRouteHref('/explorer/assets/native', '?tab=markets&holder_after=opaque&return_to=%2Fexplorer', { view: 'liquidity-pools', min: '2000', max: '3000' }, 1000, '#activity');
		const url = new URL(href, 'https://explorer.invalid');
		expect(url.searchParams.get('tab')).toBe('markets');
		expect(url.searchParams.get('holder_after')).toBe('opaque');
		expect(url.searchParams.get('return_to')).toBe('/explorer');
		expect(url.hash).toBe('#activity');
		expect(readAssetMarketRoute(url.searchParams, 1000)).toEqual({ view: 'liquidity-pools', min: '2000', max: '3000' });
		const latest = new URL(assetMarketRouteHref(url.pathname, url.search, defaultAssetMarketRoute(1000), 1000), url);
		expect(latest.searchParams.has('market_view')).toBe(false);
		expect(latest.searchParams.has('market_trade_min')).toBe(false);
		expect(latest.searchParams.get('tab')).toBe('markets');
	});
});
