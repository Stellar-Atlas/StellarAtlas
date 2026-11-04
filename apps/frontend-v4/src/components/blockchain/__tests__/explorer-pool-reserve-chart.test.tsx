import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EntityRecord } from '../../../api/explorer-analytics';

jest.unstable_mockModule('next/navigation', () => ({
	usePathname: () => '/explorer/liquidity-pools',
	useSearchParams: () => new URLSearchParams()
}));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-pool-reserve-chart.module.css', () => ({ default: {} }));
const { ExplorerPoolReserveChart } = await import('../explorer-pool-reserve-chart');
const { ExplorerInvestigationScope } = await import('../explorer-investigation');
const usd = 'USD:GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const otherUsd = 'USD:GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE';
const pool = (index: number, a: string, b: string, reserveA: string, reserveB: string): EntityRecord => ({
	id: index.toString(16).padStart(64, '0'), assetA: { id: a }, assetB: { id: b }, reserveA, reserveB,
	ledgerSequence: 65266662, deleted: false
});
const origin = '/explorer/liquidity-pools?asset=' + encodeURIComponent(usd) + '&pool_rows=25';
function render(asset: string, rows: readonly EntityRecord[]): string {
	return renderToStaticMarkup(createElement(ExplorerInvestigationScope, { origin,
		children: createElement(ExplorerPoolReserveChart, { asset, rows })
	}));
}

it('uses the matching reserve from either side, excluding other issuers and removed or unpriced rows', () => {
	const html = render(usd, [
		pool(1, usd, 'native', '0.0000001', '9007199254740990'),
		pool(2, otherUsd, usd, '123456', '9007199254740992'),
		pool(3, otherUsd, 'native', '99999999999', '12'),
		{ ...pool(4, usd, 'native', '3', '100'), deleted: true },
		{ ...pool(5, usd, 'native', '3', '100'), reserveA: null }
	]);
	expect(html).toContain('Pool reserves in USD');
	expect(html).toContain('Showing 2 of 2 comparable pools on this page');
	expect(html).toContain('9,007,199,254,740,992 USD');
	expect(html).toContain('0.0000001 USD');
	expect(html.indexOf('9,007,199,254,740,992 USD')).toBeLessThan(html.indexOf('0.0000001 USD'));
	expect(html).not.toContain('123456');
	expect(html).not.toContain('USD value');
	expect(html).toContain('Latest indexed reserves, not live balances.');
	expect(html).toContain('Source Float64 precision');
	expect(html).toContain('/explorer/ledgers/65266662');
	const link = [...html.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1]!.replaceAll('&amp;', '&'), 'https://atlas.invalid'))
		.find(url => url.pathname === '/explorer/liquidity-pools/' + pool(2, usd, 'native', '1', '1').id);
	expect(link?.searchParams.get('return_to')).toBe(origin);
});

it('keeps the visualization bounded and does not fabricate bars for missing amounts', () => {
	const rows = Array.from({ length: 10 }, (_, index) => pool(index + 1, 'native', usd, String(index), '4'));
	const html = render('NATIVE', rows);
	expect(html).toContain('Pool reserves in XLM');
	expect(html).toContain('Showing 8 of 10 comparable pools on this page');
	expect(html.match(/<li>/g)).toHaveLength(8);
	expect(render('native', [pool(1, usd, 'native', '9', '0')])).toContain('0 XLM');
	expect(render('native', [pool(1, usd, 'native', '9', 'NaN')])).toBe('');
	expect(render('USD', rows)).toBe('');
});
