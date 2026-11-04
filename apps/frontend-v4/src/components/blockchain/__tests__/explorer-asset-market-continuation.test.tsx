import * as ReactActual from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, jest } from '@jest/globals';

const page = { rows: [], window: { minLedger: 99, maxLedger: 101 }, coverageStatus: 'complete' };
let nullStates = 0;
let selection = 'tab=markets';
let failure: string | null = null;
let loading = false;

jest.unstable_mockModule('react', () => ({
	...ReactActual,
	useEffect: () => undefined,
	useState: (initial: unknown) => {
		let value = initial;
		if (initial === null) value = ++nullStates === 1
			? { assetId: 'native', rows: [], pages: [page, page], view: 'trades' }
			: failure;
		if (initial === false) value = loading;
		return [value, () => undefined];
	}
}));
jest.unstable_mockModule('next/navigation', () => ({
	usePathname: () => '/explorer/assets/native',
	useSearchParams: () => new URLSearchParams(selection)
}));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-asset-workspace.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-pool-browser', () => ({ ExplorerPoolBrowser: () => null }));
jest.unstable_mockModule('../explorer-asset-trade-table', () => ({ ExplorerAssetTradeTable: () => null }));
const { ExplorerAssetMarkets } = await import('../explorer-asset-markets');
const { ExplorerAssetMarketPairs } = await import('../explorer-asset-market-pairs');

beforeEach(() => { nullStates = 0; });

it.each([
	{ name: 'failed changed window', query: 'tab=markets&market_trade_min=2&market_trade_max=98', error: 'Request unavailable', busy: false, previous: true },
	{ name: 'loading changed window', query: 'tab=markets&market_trade_min=2&market_trade_max=98', error: null, busy: true, previous: true },
	{ name: 'accepted same window', query: 'tab=markets&market_trade_min=99&market_trade_max=101', error: null, busy: false, previous: false },
	{ name: 'implicit URL window', query: 'tab=markets', error: null, busy: false, previous: false },
	{ name: 'other safe controls', query: 'tab=markets&market_trade_min=2&market_trade_max=98&holder_cursor=next&return_to=%2Fexplorer', error: 'Request unavailable', busy: false, previous: true }
])('returns both trade sides to the accepted preview: $name', ({ query, error, busy, previous }) => {
	selection = query;
	failure = error;
	loading = busy;
	const html = renderToStaticMarkup(ReactActual.createElement(ExplorerAssetMarkets, {
		asset: { id: 'native', kind: 'native', code: 'XLM', lastObservedLedger: 101 }
	}));
	expect(html.includes('Showing previous results.')).toBe(previous);
	if (busy) expect(html).toContain('Loading trades');
	if (error) expect(html).toContain(error);
	const links = [...html.matchAll(/href="([^\"]*\/explorer\/trades\?[^\"]*)"/g)];
	expect(links).toHaveLength(2);
	for (const [index, match] of links.entries()) {
		const browse = new URL(match[1]!.replaceAll('&amp;', '&'), 'https://explorer.invalid');
		expect(browse.searchParams.get(index === 0 ? 'selling_asset' : 'buying_asset')).toBe('native');
		expect(browse.searchParams.has(index === 0 ? 'buying_asset' : 'selling_asset')).toBe(false);
		expect(browse.searchParams.get('min_ledger')).toBe('99');
		expect(browse.searchParams.get('max_ledger')).toBe('101');
		expect(browse.searchParams.get('limit')).toBe('25');
		const back = new URL(browse.searchParams.get('return_to')!, 'https://explorer.invalid');
		expect(back.pathname).toBe('/explorer/assets/native');
		expect(back.searchParams.get('tab')).toBe('markets');
		expect(back.searchParams.get('market_trade_min')).toBe('99');
		expect(back.searchParams.get('market_trade_max')).toBe('101');
		expect(back.searchParams.has('return_to')).toBe(false);
		expect(back.searchParams.get('holder_cursor')).toBe(new URLSearchParams(query).get('holder_cursor'));
	}
});

it('offers one shortcut per observed counter asset and distinguishes identical codes', () => {
	const native = { id: 'native' };
	const one = { id: 'USD:G' + 'A'.repeat(55) };
	const two = { id: 'USD:G' + 'B'.repeat(55) };
	const trade = (sellingAsset: { id: string }, buyingAsset: { id: string }) => ({ sellingAsset, buyingAsset });
	const html = renderToStaticMarkup(ReactActual.createElement(ExplorerAssetMarketPairs, {
		asset: native.id,
		origin: '/explorer/assets/native?tab=markets&market_trade_min=2&market_trade_max=98',
		rows: [trade(one, native), trade(native, one), trade(native, two), trade(one, two),
			trade(native, native), trade(native, { id: 'invalid' })],
		window: page.window
	}));
	expect(html).toContain('From this trade preview');
	expect(html).toContain('<code>' + one.id.split(':')[1] + '</code>');
	expect(html).toContain('<code>' + two.id.split(':')[1] + '</code>');
	const links = [...html.matchAll(/href="([^"]+)"/g)].map(match =>
		new URL(match[1]!.replaceAll('&amp;', '&'), 'https://explorer.invalid'));
	expect(links.map(url => url.searchParams.get('asset_b'))).toEqual([one.id, two.id]);
	for (const url of links) {
		expect(url.pathname).toBe('/explorer/markets');
		expect(url.searchParams.get('asset_a')).toBe('native');
		expect(url.searchParams.get('min_ledger')).toBe('99');
		expect(url.searchParams.get('max_ledger')).toBe('101');
		expect(url.searchParams.get('return_to')).toBe('/explorer/assets/native?tab=markets&market_trade_min=99&market_trade_max=101');
	}
});
