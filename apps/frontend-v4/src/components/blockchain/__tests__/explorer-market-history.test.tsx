import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { marketHistoryPath, parseMarketHistory } from '../../../api/explorer-market-history';

jest.unstable_mockModule('next/navigation', () => ({
	usePathname: () => '/explorer/markets',
	useSearchParams: () => new URLSearchParams()
}));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-pair-report.module.css', () => ({ default: {} }));
const { ExplorerMarketHistory, MarketHistoryContent } = await import('../explorer-market-history');

const issuer = 'GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE';
const pair = { assetA: 'KALE:' + issuer, assetB: 'native', minLedger: '100', maxLedger: '120', limit: '25' };
const observation = { timestamp: 1_800, close: '0.000000013', baseVolume: '12.500', quoteVolume: '0.0000001625', tradeCount: 2, lastTradeAt: 1_910 };
const payload = {
	base: pair.assetA, quote: pair.assetB, resolution: 300, from: 1_800, to: 3_000,
	candles: [observation, { ...observation, timestamp: 2_400, close: '1.9e-8', lastTradeAt: 2_455 }],
	source: 'history_trades', precision: 'source_float64', venues: ['classic-dex', 'native-amm'], asOf: 2_455,
	coverage: { minLedger: 100, maxLedger: 120, firstSourceTime: 1_800, lastSourceTime: 2_550,
		ledgerRangeComplete: false, timeRangeComplete: false, status: 'partial', emptyBuckets: 'omitted' }
};
const render = (value: unknown, selection = pair) => renderToStaticMarkup(createElement(MarketHistoryContent, {
	selection, history: parseMarketHistory(value, selection)
}));

it('pins a single aggregate path to the loaded report and starts with no chart or request', () => {
	expect(marketHistoryPath(pair)).toBe('/v1/markets/KALE%3A' + issuer +
		'/native/candles?min_ledger=100&max_ledger=120&resolution=300&limit=200');
	expect(() => marketHistoryPath({ ...pair, maxLedger: '' })).toThrow();
	const request = jest.spyOn(globalThis, 'fetch');
	try {
		const html = renderToStaticMarkup(createElement(ExplorerMarketHistory, { selection: pair }));
		expect(html).toContain('Load price and volume');
		expect(html).toContain('/explorer/assets/KALE%3A' + issuer);
		expect(html).not.toContain('<svg');
		expect(request).not.toHaveBeenCalled();
	} finally { request.mockRestore(); }
});

it('renders only observed bins at proportional time positions and exposes exact values and UTC times', () => {
	const html = render(payload);
	expect(html).toContain('XLM per KALE');
	expect(html).toContain('Ledger coverage is partial');
	expect(html).toContain('beyond the published source bounds');
	expect(html).toContain('Last included trade:');
	expect(html).toContain('1970-01-01T00:40:55.000Z');
	expect(html).toContain('0.000000013');
	expect(html).toContain('Gaps are omitted, not zero');
	expect(html).toContain('Volume (XLM)');
	expect(html).toContain('viewBox="0 0 640 104"');
	expect([...html.matchAll(/<circle cx="(\d+)"/g)].map(match => Number(match[1]))).toEqual([120, 520]);
	expect(html.match(/<rect /g)).toHaveLength(2);
	expect(html).not.toContain('<polyline');
	expect(html).not.toContain('USD');
});

it('keeps no-trade and unpublished windows distinct and rejects mislabeled or corrupt data', () => {
	expect(render({ ...payload, candles: [], asOf: null })).toContain('No trades were found');
	const absent = { ...payload, candles: [], from: 0, to: 0, asOf: null,
		coverage: { ...payload.coverage, firstSourceTime: null, lastSourceTime: null } };
	expect(render(absent)).toContain('No published trade source');
	for (const invalid of [
		{ ...payload, base: 'native' }, { ...payload, asOf: 2_450 },
		{ ...payload, candles: [observation, observation] },
		{ ...payload, candles: Array.from({ length: 201 }, () => observation) },
		{ ...payload, candles: [{ ...observation, close: 'Infinity' }] },
		{ ...payload, coverage: { ...payload.coverage, maxLedger: 121 } }
	]) expect(() => parseMarketHistory(invalid, pair)).toThrow('Invalid price and volume response.');
});

it('labels a native base and classic quote without accepting missing identifiers', () => {
	const reversed = { ...pair, assetA: pair.assetB, assetB: pair.assetA };
	const html = render({ ...payload, base: reversed.assetA, quote: reversed.assetB }, reversed);
	expect(html).toContain('KALE per XLM');
	expect(html).not.toContain(issuer);
	for (const incomplete of [{ ...pair, assetA: '' }, { ...pair, assetB: '' }]) {
		expect(() => marketHistoryPath(incomplete)).toThrow();
		expect(() => parseMarketHistory(payload, incomplete)).toThrow();
	}
});
