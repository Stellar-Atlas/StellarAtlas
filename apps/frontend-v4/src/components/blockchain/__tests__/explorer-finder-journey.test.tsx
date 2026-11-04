import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { explorerSearchNavigation, resolveExplorerSearch } from '../../../api/explorer-search-route';
import { assetDiscoveryHref, assetDiscoveryPath, readAssetDiscoverySelection } from '../asset-discovery-page';

const site = 'https://atlas.invalid';
const issuer = 'GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE';
const otherIssuer = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const sac = 'CBQSUF57OYX4RIMCZV62DKN6JFOTEKPHIZASMJYOUOCNHGNG2P3XQLSE';
const hash = 'a'.repeat(64);
const id = 'KALE:' + issuer;
let location = new URL('/explorer', site);
jest.unstable_mockModule('next/navigation', () => ({
	usePathname: () => location.pathname,
	useSearchParams: () => location.searchParams
}));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-asset-workspace.module.css', () => ({ default: {} }));
const { ExplorerInvestigation, ExplorerInvestigationScope } = await import('../explorer-investigation');
const { AssetTable } = await import('../explorer-asset-views');
const { ExplorerTransferTable } = await import('../explorer-transfer-table');

function links(html: string): URL[] {
	return [...html.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1]!.replaceAll('&amp;', '&'), site));
}

it('opens asset candidates from the finder and restores the paged range through linked records', () => {
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
				{ id, kind: 'classic', code: 'KALE', issuer },
				{ id: 'KALE:' + otherIssuer, kind: 'classic', code: 'KALE', issuer: otherIssuer }
			] })
		})));
	const assets = links(results).filter(url => url.pathname.startsWith('/explorer/assets/'));
	expect(assets.map(url => decodeURIComponent(url.pathname.split('/').at(-1)!))).toEqual([id, 'KALE:' + otherIssuer]);
	location = assets[0]!;
	const activity = renderToStaticMarkup(createElement(ExplorerInvestigation, null,
		createElement(ExplorerTransferTable, { rows: [{
			id: 'fixture', ledgerSequence: 121, closedAt: '2026-11-04T00:00:00Z', transactionHash: hash,
			transactionId: '1', operationId: null, from: issuer, to: otherIssuer, toMuxed: null,
			asset: { id, code: 'KALE', issuer, type: 'credit_alphanum4' }, contractId: null,
			eventTopic: 'transfer', amountRaw: '10000000', amountScale: 7
		}] })));
	const transaction = links(activity).find(url => url.pathname === '/explorer/transactions/' + hash)!;
	expect(transaction.searchParams.get('ledger_sequence')).toBe('121');
	location = new URL(transaction.href, site); // Direct open/reload, with no local UI state.
	const back = links(renderToStaticMarkup(createElement(ExplorerInvestigation, { children: null })))[0]!;
	expect(back.pathname).toBe('/explorer/assets');
	expect(readAssetDiscoverySelection(back.searchParams)).toEqual(selection);
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
