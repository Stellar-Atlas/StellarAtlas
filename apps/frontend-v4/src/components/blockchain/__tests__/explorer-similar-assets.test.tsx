import { jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SimilarAssetsPage } from '../similar-assets-page';

const issuer = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const otherIssuer = 'GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE';
const asset = 'XLM:' + issuer;
const other = 'XLM:' + otherIssuer;
const detail = (id: string) => '/explorer/assets/' + encodeURIComponent(id);
const origin = detail(asset) + '?tab=same-symbol&similar_after=page_two&similar_for=' + encodeURIComponent(asset);
const base = 'https://explorer.invalid';
const rows: SimilarAssetsPage['rows'] = [
	{ id: other, kind: 'classic', code: 'XLM', issuer: otherIssuer, source: 'https://example.org/reference' },
	{ id: 'native', kind: 'native', code: 'XLM', issuer: null, source: null }
];

let route = new URL(origin, base);
const comparison = jest.fn((id: string, _cursor: string | null, _enabled: boolean) => ({
	page: { rows: id === asset ? rows : [], next: null, generatedAt: null },
	busy: false, error: null, cancel: jest.fn(), retry: jest.fn()
}));
const holders = jest.fn((_props: { identifier: string; autoLoad: boolean }) => null);
jest.unstable_mockModule('next/navigation', () => ({
	usePathname: () => route.pathname, useSearchParams: () => route.searchParams
}));
jest.unstable_mockModule('next/link', () => ({ default: () => null }));
jest.unstable_mockModule('../use-similar-assets-page', () => ({ useSimilarAssetsPage: comparison }));
jest.unstable_mockModule('../explorer-asset-holders', () => ({ ExplorerAssetHolders: holders }));
jest.unstable_mockModule('../explorer-asset-markets', () => ({ ExplorerAssetMarkets: () => null }));
jest.unstable_mockModule('../explorer-asset-activity', () => ({ ExplorerAssetActivity: () => null }));
jest.unstable_mockModule('../explorer-contract-activity', () => ({ ExplorerContractActivity: () => null }));
jest.unstable_mockModule('../explorer-asset-reports', () => ({ ExplorerAssetReports: () => null }));
jest.unstable_mockModule('../explorer-issuer-metadata', () => ({ ParsedIssuerMetadata: () => null }));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: { panel: 'panel', table: 'table' } }));
jest.unstable_mockModule('../explorer-asset-workspace.module.css', () => ({ default: {} }));

const { ExplorerInvestigation } = await import('../explorer-investigation');
const { ExplorerAssetTabs } = await import('../explorer-asset-tabs');
const { similarAssetsPath } = await import('../similar-assets-page');
const render = (id: string) => renderToStaticMarkup(
	<ExplorerInvestigation><ExplorerAssetTabs record={{ asset: { id, kind: 'classic', code: 'XLM', issuer: id.split(':')[1] } }} /></ExplorerInvestigation>
);
const href = (markup: string, label: string) => {
	const match = [...markup.matchAll(/<a([^>]*)>([^<]*)<\/a>/g)].find(([, attrs, text]) =>
		text === label || attrs?.includes('aria-label="' + label + '"'));
	const target = match?.[1]?.match(/\bhref="([^"]+)"/)?.[1];
	if (!target) throw new Error('Missing link: ' + label);
	return new URL(target.replaceAll('&amp;', '&'), base);
};

beforeEach(() => {
	route = new URL(origin, base);
	comparison.mockClear();
	holders.mockClear();
});

it('opens the target comparison at page one, with exact return context and without mounting holders', () => {
	const source = render(asset);
	const compare = href(source, 'Compare XLM issued by ' + otherIssuer);
	const normal = href(source, 'XLM');
	expect(normal.pathname).toBe(detail(other));
	expect(normal.searchParams.has('tab')).toBe(false);
	expect(compare.pathname).toBe(detail(other));
	expect([...compare.searchParams]).toEqual([['tab', 'same-symbol'], ['return_to', origin]]);

	route = compare;
	comparison.mockClear();
	const target = render(other);
	expect(comparison.mock.calls).toEqual([[other, null, true]]);
	expect(similarAssetsPath(other, null)).toBe('/v1/assets/' + encodeURIComponent(other) + '/similar?limit=25');
	expect(holders).not.toHaveBeenCalled();
	expect(href(target, '← Back to investigation').pathname + href(target, '← Back to investigation').search).toBe(origin);

	route = normal;
	render(other);
	expect(holders.mock.calls).toEqual([[{ identifier: other, autoLoad: true }]]);
});

it('keeps the action inside the labelled mobile cell, without changing identity or attribution', () => {
	const source = render(asset);
	expect(source).toContain('A matching symbol does not establish authenticity.');
	expect(source).toMatch(/<td data-label="Asset"><div><a[^>]*>XLM<\/a><div><a[^>]*>Compare<\/a><\/div><\/div><\/td>/);
	expect(source.match(/>Compare<\/a>/g)).toHaveLength(1);
	expect(href(source, otherIssuer).pathname).toBe('/explorer/issuers/' + otherIssuer);
	expect(href(source, otherIssuer).searchParams.get('return_to')).toBe(origin);
	expect(href(source, 'Project reference').href).toBe('https://example.org/reference');
	expect(source).toContain('Native asset');
	expect(source).not.toContain('/explorer/issuers/null');
});
