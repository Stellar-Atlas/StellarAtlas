import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Asset } from '../explorer-asset-types';
import { parseAsset } from '../asset-data';
import { readStateRoute, statePositionHref } from '../contract-state-route';

const initialSearch = 'tab=contracts-events&min_ledger=100&max_ledger=101';
const site = 'https://explorer.invalid';
let pathname = '/explorer/assets/native';
let search = initialSearch;
const contract = 'CA526Y2NQWGWVVQ7RFFPGAZMU66PSYJ3UC2MTVAV4ZU7OM5BOPHDXUSG';
const explicit = 'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA';
const issuer = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const activity = jest.fn(({ contractId }: { contractId: string }) => createElement('div', { 'data-contract': contractId }));
jest.unstable_mockModule('next/navigation', () => ({ usePathname: () => pathname, useSearchParams: () => new URLSearchParams(search) }));
jest.unstable_mockModule('next/link', () => ({ default: ({ href, prefetch, children }: { href: string; prefetch?: boolean; children: React.ReactNode }) =>
	createElement('a', { href, 'data-prefetch': prefetch }, children) }));
jest.unstable_mockModule('../explorer-asset-workspace.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-issuer-metadata', () => ({ ParsedIssuerMetadata: () => null }));
jest.unstable_mockModule('../explorer-asset-holders', () => ({ ExplorerAssetHolders: () => null }));
jest.unstable_mockModule('../explorer-asset-markets', () => ({ ExplorerAssetMarkets: () => null }));
jest.unstable_mockModule('../explorer-asset-activity', () => ({ ExplorerAssetActivity: () => null }));
jest.unstable_mockModule('../explorer-similar-assets', () => ({ ExplorerSimilarAssets: () => null }));
jest.unstable_mockModule('../explorer-asset-reports', () => ({ ExplorerAssetReports: () => null }));
jest.unstable_mockModule('../explorer-contract-activity', () => ({ ExplorerContractActivity: activity }));
const { ExplorerAssetTabs } = await import('../explorer-asset-tabs');
const { ExplorerInvestigation } = await import('../explorer-investigation');
const render = (asset: Asset) => renderToStaticMarkup(createElement(ExplorerInvestigation, null,
	createElement(ExplorerAssetTabs, { record: { asset } })));
const links = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1]!.replaceAll('&amp;', '&'), site));
const contractLink = (html: string) => links(html).find(url => url.pathname.startsWith('/explorer/contracts/'))!;
const renderBack = (detail: URL): URL => {
	pathname = detail.pathname;
	search = detail.search;
	return links(renderToStaticMarkup(createElement(ExplorerInvestigation, { children: null })))[0]!;
};
beforeEach(() => { activity.mockClear(); pathname = '/explorer/assets/native'; search = initialSearch; });

it('renders accessible concise feedback for permitted missing classic/native identities without mounting activity', () => {
	for (const input of [{ id: 'native', kind: 'native' }, { id: 'USD:' + issuer, kind: 'classic', issuer }]) {
		const html = render(parseAsset(input));
		expect(html).toContain('aria-label="Contract activity"');
		expect(html).toContain('role="status">Contract address unavailable for this asset.');
		expect(html).not.toMatch(/undeployed|no activity|no events/i);
		expect(contractLink(html)).toBeUndefined();
	}
	expect(activity).not.toHaveBeenCalled();
});
it('reuses a checksum-valid contract asset identity when its optional duplicate field is absent', () => {
	pathname = '/explorer/assets/' + contract;
	const html = render(parseAsset({ id: contract, kind: 'contract' }));
	expect(contractLink(html).pathname).toBe('/explorer/contracts/' + contract);
	expect(contractLink(html).searchParams.get('return_to')).toBe(pathname + '?' + search);
	expect(activity).toHaveBeenCalledTimes(1);
	expect(activity).toHaveBeenCalledWith(expect.objectContaining({ contractId: contract, filters: {}, token: undefined }), undefined);
	expect(html).not.toContain('Contract address unavailable');
});
it('preserves explicit classic SAC identity and exact token context', () => {
	const asset = parseAsset({ id: 'USD:' + issuer, kind: 'classic', code: 'USD', issuer, contractId: explicit });
	const html = render(asset);
	expect(html).toContain('Stellar Asset Contract activity');
	expect(html).toContain('data-prefetch="false"');
	expect(contractLink(html).pathname).toBe('/explorer/contracts/' + explicit);
	expect(activity.mock.calls[0]?.[0]).toEqual({ contractId: explicit, filters: {}, token: { contractId: explicit, assetId: asset.id, symbol: 'USD', decimals: 7 } });
});
it('keeps an explicit contract address authoritative and rejects an invalid fallback identity', () => {
	render(parseAsset({ id: contract, kind: 'contract', contractId: explicit }));
	expect(activity.mock.calls[0]?.[0]).toEqual({ contractId: explicit, filters: {}, token: undefined });
	activity.mockClear();
	expect(render(parseAsset({ id: 'C' + 'A'.repeat(55), kind: 'contract' }))).toContain('Contract address unavailable');
	expect(activity).not.toHaveBeenCalled();
});
it('does not show missing-contract feedback or mount activity on another asset tab', () => {
	search = 'tab=transfers';
	expect(render(parseAsset({ id: 'native', kind: 'native' }))).not.toContain('Contract address unavailable');
	expect(activity).not.toHaveBeenCalled();
});

it('returns from the known contract to the exact event page rather than the inherited catalogue', () => {
	const asset = parseAsset({ id: 'USD:' + issuer, kind: 'classic', code: 'USD', issuer, contractId: explicit });
	pathname = '/explorer/assets/' + encodeURIComponent(asset.id);
	const eventQuery = new URLSearchParams(initialSearch);
	for (const [key, value] of Object.entries({ type_code: '1', topic: 'transfer', order: 'asc', limit: '25', after: 'event-next', q: issuer }))
		eventQuery.set(key, value);
	const expected = pathname + '?' + eventQuery;
	eventQuery.set('return_to', '/explorer/assets?symbol=USD&cursor=catalogue-next');
	search = eventQuery.toString();
	const detail = contractLink(render(asset));
	expect([...detail.searchParams.keys()]).toEqual(['return_to']);
	expect(detail.searchParams.get('return_to')).toBe(expected);
	const back = renderBack(detail);
	expect(back.pathname + back.search).toBe(expected);
	expect(activity).toHaveBeenCalledTimes(1);
});

it('restores the bound state page for native XLM and discards nested off-site return values', () => {
	const base = initialSearch + '&durability=persistent&deleted=false&limit=10';
	const selection = readStateRoute(explicit, {}, new URLSearchParams(base));
	const expected = statePositionHref(pathname, base, selection, '20');
	search = new URL(expected, site).search + '&return_to=' + encodeURIComponent('//example.invalid/');
	const native = parseAsset({ id: 'native', kind: 'native', contractId: explicit });
	const detail = contractLink(render(native));
	expect(detail.pathname).toBe('/explorer/contracts/' + explicit);
	const back = renderBack(detail);
	expect(back.pathname + back.search).toBe(expected);
	expect(back.searchParams.has('return_to')).toBe(false);
	expect(readStateRoute(explicit, {}, back.searchParams).position).toBe('20');
	expect(activity.mock.calls[0]?.[0]).toEqual({ contractId: explicit, filters: {}, token: { contractId: explicit, assetId: 'native', symbol: 'XLM', decimals: 7 } });
	pathname = '//example.invalid/explorer/assets/native';
	search = initialSearch;
	expect(contractLink(render(native)).search).toBe('');
});
