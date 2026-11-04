import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.unstable_mockModule('next/navigation', () => ({
	usePathname: () => '/explorer/liquidity-pools',
	useSearchParams: () => new URLSearchParams()
}));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-pool-table.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-asset-pair', () => ({ ExplorerAssetPair: () => null, usePairMetadata: () => ({}) }));
const { ExplorerPoolTable } = await import('../explorer-pool-table');
const { ExplorerInvestigationScope } = await import('../explorer-investigation');
const pool = 'a'.repeat(64);
const origin = '/explorer/liquidity-pools?min_ledger=100&max_ledger=150&offset=25&order_by=trustlines';
const rows = [
	{ id: pool, ledgerSequence: 120, deleted: false },
	{ id: pool, ledgerSequence: 121, deleted: true },
	{ id: pool, ledgerSequence: null }
];
function poolLinks(context?: Record<string, string>): URL[] {
	const html = renderToStaticMarkup(createElement(ExplorerInvestigationScope, { origin,
		children: createElement(ExplorerPoolTable, { rows, ...(context ? { context } : {}) })
	}));
	return [...html.matchAll(/href="(\/explorer\/liquidity-pools\/[^"]+)"/g)]
		.map(match => new URL(match[1]!.replaceAll('&amp;', '&'), 'https://atlas.invalid'));
}

it('opens each historical row at its observed ledger without losing the filtered pool page', () => {
	const links = poolLinks({ min_ledger: '100', max_ledger: '150', start_time: '2026-11-04T00:00:00Z' });
	expect(links.map(link => Object.fromEntries(link.searchParams))).toEqual([
		{ min_ledger: '120', max_ledger: '120', deleted: 'false', return_to: origin },
		{ min_ledger: '121', max_ledger: '121', deleted: 'true', return_to: origin }
	]);
});

it('keeps latest-pool links pointed at latest state', () => {
	for (const link of poolLinks()) {
		expect(link.pathname).toBe('/explorer/liquidity-pools/' + pool);
		expect(Object.fromEntries(link.searchParams)).toEqual({ return_to: origin });
	}
});
