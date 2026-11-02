import { assetMarketRouteHref, defaultAssetMarketRoute, readAssetMarketRoute } from '../asset-market-route';

describe('asset market URL state', () => {
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
