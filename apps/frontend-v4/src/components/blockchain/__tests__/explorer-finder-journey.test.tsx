import { afterEach, expect, it, jest } from '@jest/globals';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as explorerAnalytics from '../../../api/explorer-analytics';
import { explorerSearchNavigation, resolveExplorerSearch } from '../../../api/explorer-search-route';
import { assetActivityHref } from '../asset-activity-page';
import { assetDiscoveryHref, assetDiscoveryPath, readAssetDiscoverySelection } from '../asset-discovery-page';
import { assetTabHref } from '../asset-tab-route';
import { HookHarness } from './asset-workspace-hook-harness';

const { createElement } = React;

const site = 'https://atlas.invalid';
const issuer = 'GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE';
const otherIssuer = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const sac = 'CBQSUF57OYX4RIMCZV62DKN6JFOTEKPHIZASMJYOUOCNHGNG2P3XQLSE';
const hash = 'a'.repeat(64);
const id = 'KALE:' + issuer;
const asset = { id, kind: 'classic' as const, code: 'KALE', issuer, lastObservedLedger: 140 };
const hooks = new HookHarness();
let location = new URL('/explorer', site);
const closedAt = '2026-11-04T00:00:00Z';
const request = jest.fn(async (_path: string, _signal: AbortSignal) => ({
	transfers: [{
		id: 'fixture', ledgerSequence: 121, closedAt, transactionHash: hash,
		transactionId: '1', operationId: null, from: issuer, to: otherIssuer, toMuxed: null,
		asset: { id, code: 'KALE', issuer, type: 'credit_alphanum4' }, contractId: '',
		eventTopic: 'transfer', amountRaw: '10000000', amountScale: 7
	}],
	limit: 25, nextCursor: null, elapsedMilliseconds: 1,
	watermark: { minimumLedger: 2, maximumLedger: 140, coverage: 'ingested-only', observedAt: closedAt }
}));
jest.unstable_mockModule('react', () => ({
	...React, useEffect: hooks.useEffect, useRef: hooks.useRef, useState: hooks.useState
}));
jest.unstable_mockModule('next/navigation', () => ({
	usePathname: () => location.pathname,
	useSearchParams: () => location.searchParams,
	useRouter: () => ({ push: jest.fn() })
}));
jest.unstable_mockModule('../../../api/explorer-analytics', () => ({ ...explorerAnalytics, requestExplorerJson: request }));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-asset-workspace.module.css', () => ({ default: {} }));
const { ExplorerInvestigation, ExplorerInvestigationScope } = await import('../explorer-investigation');
const { AssetTable } = await import('../explorer-asset-views');
const { ExplorerAssetTabs } = await import('../explorer-asset-tabs');
const { ExplorerSearchForm } = await import('../explorer-search-form');

afterEach(() => {
	hooks.reset();
	Reflect.deleteProperty(globalThis, 'window');
});

function links(html: string): URL[] {
	return [...html.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1]!.replaceAll('&amp;', '&'), site));
}

async function renderAssetTransfers(): Promise<string> {
	const render = () => hooks.render(() => renderToStaticMarkup(createElement(ExplorerInvestigation, null,
		createElement(ExplorerAssetTabs, { record: { asset } }))));
	render();
	await new Promise<void>(resolve => setImmediate(resolve));
	return render();
}

it('opens actual asset Transfers from paged candidates and restores both pages after transaction reload', async () => {
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { get location() { return location; } } });
	const start = explorerSearchNavigation(site + '/explorer', ' KALE ', 'auto')!;
	expect(start.origin).toBe('/explorer?search=KALE&search_type=auto');
	location = new URL(start.destination, site);
	expect(location.pathname).toBe('/explorer/assets');
	expect(location.searchParams.get('return_to')).toBe(start.origin);
	const first = readAssetDiscoverySelection(location.searchParams);
	expect(assetDiscoveryPath(first)).toBe('/v1/assets?symbol=KALE&limit=25');

	const selection = { query: { ...first.query, min_ledger: '100', max_ledger: '140' }, cursor: 'next_page' };
	const paged = new URL(assetDiscoveryHref(location.search, selection), site);
	location = paged;
	const results = renderToStaticMarkup(createElement(ExplorerInvestigation, null,
		createElement(ExplorerInvestigationScope, { origin: paged.pathname + paged.search, children:
			createElement(AssetTable, { filters: selection.query, assets: [
				asset,
				{ id: 'KALE:' + otherIssuer, kind: 'classic', code: 'KALE', issuer: otherIssuer }
			] })
		})));
	const assets = links(results).filter(url => url.pathname.startsWith('/explorer/assets/'));
	expect(assets.map(url => decodeURIComponent(url.pathname.split('/').at(-1)!))).toEqual([id, 'KALE:' + otherIssuer]);
	const detail = assets[0]!;
	const transfers = new URL(assetTabHref(detail.pathname, detail.search, 'Transfers'), site);
	location = new URL(assetActivityHref(transfers.pathname, transfers.search, asset, { before: 140, after: 'transfer_page' }), site);
	const activity = await renderAssetTransfers();
	expect(activity).toContain('Asset transfer activity');
	const expectedRequest = '/v1/activity/transfers?limit=25&asset=' + encodeURIComponent(id) +
		'&min_ledger=2&max_ledger=140&after=transfer_page';
	expect(request).toHaveBeenLastCalledWith(expectedRequest, expect.any(AbortSignal));
	expect(activity).not.toContain('role="alert"');
	const transaction = links(activity).find(url => url.pathname === '/explorer/transactions/' + hash)!;
	expect(transaction.searchParams.get('ledger_sequence')).toBe('121');
	hooks.reset();
	location = new URL(transaction.href, site); // Direct open/reload, with no local UI state.
	const backToAsset = links(renderToStaticMarkup(createElement(ExplorerInvestigation, { children: null })))[0]!;
	expect(backToAsset.pathname).toBe(detail.pathname);
	expect(backToAsset.searchParams.get('tab')).toBe('transfers');
	expect(backToAsset.searchParams.get('asset_activity_after')).toBe('transfer_page');
	location = backToAsset;
	const reloaded = await renderAssetTransfers();
	expect(request).toHaveBeenCalledTimes(2);
	expect(request).toHaveBeenLastCalledWith(expectedRequest, expect.any(AbortSignal));
	const backToCatalogue = links(reloaded)[0]!;
	expect(backToCatalogue.pathname).toBe('/explorer/assets');
	expect(readAssetDiscoverySelection(backToCatalogue.searchParams)).toEqual(selection);
	expect(backToCatalogue.searchParams.has('return_to')).toBe(false);
});

it('omits a flattened catalogue target when it would make the actual transaction link exceed 4096 characters', async () => {
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { get location() { return location; } } });
	const prefix = '/explorer/assets?symbol=USDC&market_context=';
	const catalogue = prefix + 'x'.repeat(4090 - prefix.length);
	expect(readAssetDiscoverySelection(new URL(catalogue, site).searchParams)).toEqual({
		query: { symbol: 'USDC' }, cursor: null
	});
	location = new URL('/explorer/assets/' + encodeURIComponent(id), site);
	location.searchParams.set('tab', 'transfers');
	location.searchParams.set('return_to', catalogue);
	const html = await renderAssetTransfers();
	const transaction = links(html).find(url => url.pathname === '/explorer/transactions/' + hash);
	expect(transaction?.href).toBe(site + '/explorer/transactions/' + hash + '?ledger_sequence=121');
});

it('keeps exact identifiers and only routes a C-address to assets when explicitly requested', () => {
	expect(resolveExplorerSearch(id)).toBe('/explorer/assets/' + encodeURIComponent(id));
	expect(resolveExplorerSearch(sac)).toBe('/explorer/contracts/' + sac);
	expect(resolveExplorerSearch(sac, 'asset')).toBe('/explorer/assets/' + sac);
	expect(resolveExplorerSearch(sac.slice(0, -1) + 'A', 'asset')).toBeNull();
	expect(resolveExplorerSearch(issuer)).toBe('/explorer/accounts/' + issuer);
	expect(resolveExplorerSearch(hash)).toBe('/explorer/transactions/' + hash);
	expect(resolveExplorerSearch('121')).toBe('/explorer/ledgers/121');
	expect(resolveExplorerSearch('121', 'asset')).toBe('/explorer/assets?symbol=121');
	expect(resolveExplorerSearch('kale')).toBe('/explorer/assets?symbol=kale');
	expect(resolveExplorerSearch('KALE/USDC')).toBeNull();
});

it('opens a canonical Soroban Domains lookup and restores the selected finder mode from rendered Back', () => {
	const start = new URL('/explorer', site);
	start.searchParams.set('noise', 'x'.repeat(4090));
	start.searchParams.set('return_to', '//outside.invalid');
	const name = 'Treasury.Addresses.MATE.XLM';
	const search = explorerSearchNavigation(start.href, ' ' + name + ' ', 'soroban-domain')!;
	location = new URL(search.destination, site);
	expect(location.pathname).toBe('/explorer/soroban-domains');
	expect(location.searchParams.get('name')).toBe('treasury.addresses.mate.xlm');
	expect(search.destination.length).toBeLessThan(256);
	const back = links(renderToStaticMarkup(createElement(ExplorerInvestigation, { children: null })))[0]!;
	expect(back.pathname).toBe('/explorer');
	expect(Object.fromEntries(back.searchParams)).toEqual({ search: name, search_type: 'soroban-domain' });
	location = back;
	const form = hooks.render(() => renderToStaticMarkup(createElement(ExplorerSearchForm)));
	expect(form).toContain('<option value="soroban-domain" selected="">Soroban Domains (.xlm)</option>');
	expect(form).toContain('placeholder="example.xlm"');
	expect(form).toContain('value="' + name + '"');
});

it('keeps .xlm protocol lookup explicit and rejects other namespaces and unsupported labels', () => {
	expect(resolveExplorerSearch('mate.xlm')).toBeNull();
	expect(resolveExplorerSearch('mate.xlm', 'asset')).toBeNull();
	for (const query of ['mate.com', 'https://mate.xlm', 'mate..xlm', 'máte.xlm', 'a.b.c.d.e.xlm', issuer]) {
		expect(resolveExplorerSearch(query, 'soroban-domain')).toBeNull();
	}
});

it('offers both domain modes and uses only the selected namespace and input limit', () => {
	const hostname = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.') + '.';
	const result = explorerSearchNavigation(site + '/explorer', hostname, 'issuer-domain')!;
	location = new URL(result.destination, site);
	expect(location.pathname).toBe('/explorer/issuers/by-domain');
	expect(location.searchParams.get('domain')).toBe(hostname.slice(0, -1));
	location = new URL(location.searchParams.get('return_to')!, site);
	const form = hooks.render(() => renderToStaticMarkup(createElement(ExplorerSearchForm)));
	expect(form).toContain('<option value="issuer-domain" selected="">Issuer domain</option>');
	expect(form).toContain('<option value="soroban-domain">Soroban Domains (.xlm)</option>');
	expect(form).toContain('maxLength="254"');
	expect(form).toContain('value="' + hostname + '"');
	expect(resolveExplorerSearch(hostname, 'soroban-domain')).toBeNull();
	expect(resolveExplorerSearch('mate.xlm', 'issuer-domain')).toBeNull();
});
