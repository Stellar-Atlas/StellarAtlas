import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { jest } from '@jest/globals';
import { pairReportHref } from '../../../api/explorer-pair-report';
import { assetPairReportHref } from '../asset-market-route';
const site = 'https://explorer.invalid';
let location = new URL('/explorer/markets', site);
jest.unstable_mockModule('next/navigation', () => ({
	usePathname: () => location.pathname,
	useSearchParams: () => location.searchParams
}));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-asset-workspace.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-asset-pair', () => ({
	usePairMetadata: () => ({}),
	ExplorerAssetPair: () => createElement('span', null, 'USD / XLM')
}));
const { ExplorerAssetTradeTable } = await import('../explorer-asset-trade-table');
const { ExplorerInvestigation } = await import('../explorer-investigation');
it('labels mobile values together and preserves source decimal text and accepted-window links', () => {
	const issuer = 'G' + 'A'.repeat(55);
	const html = renderToStaticMarkup(createElement(ExplorerAssetTradeTable, {
		asset: 'USD:' + issuer, origin: '/explorer/assets/USD%3A' + issuer + '?tab=markets',
		window: { minLedger: 99, maxLedger: 101 }, rows: [{ id: 'trade', operationId: '429496729603',
			sellingAsset: { id: 'USD:' + issuer, code: 'USD' }, buyingAsset: { id: 'native' },
			sellingAmount: '9007199254740993.1234567', buyingAmount: '1.2300000', ledgerSequence: 100,
			closedAt: '2026-11-02T01:00:00Z' }]
	}));
	for (const label of ['Pair', 'Sold → bought', 'Operation', 'Ledger', 'Time', 'Report']) expect(html).toContain('data-label="' + label + '"');
	expect(html).toContain('9,007,199,254,740,993.1234567');
	expect(html).toContain('1.23');
	expect(html).toContain('/explorer/operations/429496729603');
	expect(html).toContain('/explorer/ledgers/100');
	expect(html).toContain('asset_a=USD%3A' + issuer + '&amp;asset_b=native&amp;min_ledger=99&amp;max_ledger=101');
	expect(html).not.toContain('…');
});

it('keeps the inspected asset as base and restores the accepted market tab after a report reload', () => {
	const id = 'KALE:GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE';
	const origin = '/explorer/assets/' + encodeURIComponent(id) + '?tab=markets&market_trade_min=2&market_trade_max=98';
	const window = { minLedger: 99, maxLedger: 101 };
	const rows = [
		{ id: 'buy', sellingAsset: { id: 'native' }, buyingAsset: { id }, ledgerSequence: 99 },
		{ id: 'sell', sellingAsset: { id }, buyingAsset: { id: 'native' }, ledgerSequence: 100 },
		{ id: 'unsupported', sellingAsset: { id }, buyingAsset: { id: 'not-an-asset' }, ledgerSequence: 101 }
	];
	const html = renderToStaticMarkup(createElement(ExplorerAssetTradeTable, { asset: id, origin, window, rows }));
	const pairLinks = [...html.matchAll(/href="(\/explorer\/markets\?[^"]+)"/g)];
	expect(pairLinks).toHaveLength(2);
	expect(pairLinks[0]![1]).toBe(pairLinks[1]![1]);
	const pair = new URL(pairLinks[0]![1]!.replaceAll('&amp;', '&'), site);
	expect(pair.searchParams.get('asset_a')).toBe(id);
	expect(pair.searchParams.get('asset_b')).toBe('native');
	expect(pair.searchParams.get('min_ledger')).toBe('99');
	expect(pair.searchParams.get('max_ledger')).toBe('101');

	const accepted = { assetA: id, assetB: 'native', minLedger: '99', maxLedger: '101', limit: '25' };
	location = new URL(pairReportHref(accepted, { 'a-to-b': 25 }, pair.searchParams.get('return_to')), site);
	expect(location.searchParams.get('a-to-b_offset')).toBe('25');
	const reload = renderToStaticMarkup(createElement(ExplorerInvestigation, { children: null }));
	const back = new URL(reload.match(/href="([^"]+)"/)![1]!.replaceAll('&amp;', '&'), site);
	expect(back.pathname).toBe('/explorer/assets/' + encodeURIComponent(id));
	expect(Object.fromEntries(back.searchParams)).toEqual({ tab: 'markets', market_trade_min: '99', market_trade_max: '101' });
	expect(assetPairReportHref(id, 'native', 'USD', window, origin)).toBeNull();
	expect(new URL(pairReportHref(accepted, {}, '//example.invalid/'), site).searchParams.has('return_to')).toBe(false);
});
