import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BalanceObservationPage } from '../../../api/explorer-balance-observations';
let search = '';
jest.unstable_mockModule('next/navigation', () => ({
	usePathname: () => '/explorer/accounts/GACCOUNT',
	useSearchParams: () => new URLSearchParams(search)
}));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({
	default: {}
}));
jest.unstable_mockModule('../explorer-account-assets.module.css', () => ({ default: {} }));
const { ExplorerBalanceObservations, BalanceObservationResults } =
	await import('../explorer-balance-observations');
const page: BalanceObservationPage = {
	rows: [
		{
			id: 'native',
			balance: 12.3456789,
			buyingLiabilities: 1,
			sellingLiabilities: 2,
			observedLedger: 63490364,
			lastModifiedLedger: 63490360,
			trustLineLimit: '9223372036854775807'
		}
	],
	nextCursor: 'next',
	catalogGeneratedAt: '2026-09-08T02:00:00Z',
	maximumLedger: '63490367',
	totalLedgerCount: '30000000',
	contiguousLastLedger: '29999937',
	gapCount: 1
};

describe('explorer balance observation presentation', () => {
	it.each(['balances', 'holders'] as const)(
		'keeps %s requests user-triggered and marks their semantics before loading',
		(kind) => {
			const html = renderToStaticMarkup(
				createElement(ExplorerBalanceObservations, {
					kind,
					identifier: kind === 'balances' ? 'GA' : 'native'
				})
			);
			expect(html).toContain(`Load ${kind}`);
			expect(html).toContain('not current-chain or historical as-of balances');
			expect(html).toContain('Float64');
			expect(html).not.toContain('0 returned');
			expect(html).not.toContain('No balances');
		}
	);
	it('labels automatically loaded account balances as parsed observations', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerBalanceObservations, {
				autoLoad: true,
				kind: 'balances',
				identifier: 'GACCOUNT'
			})
		);
		expect(html).toContain('Refresh first page');
		expect(html).not.toContain('Load balances');
		expect(html).toContain('Latest ingested observations');
		expect(html).toContain('not current-chain or historical as-of balances');
	});
	it('keeps a first-page exit visible on a shared continuation before any rows load', () => {
		search = 'wallet_for=GACCOUNT&wallet_after=next&tab=activity';
		try {
			const html = renderToStaticMarkup(createElement(ExplorerBalanceObservations, {
				kind: 'balances', identifier: 'GACCOUNT'
			}));
			expect(html).toContain('Go to first balances page');
			expect(html).toMatch(/<button[^>]*disabled[^>]*>Next balances<\/button>/);
			expect(html).not.toContain('Refresh first page');
			expect(html).not.toContain('No balances');
		} finally { search = ''; }
	});
	it('renders observed amounts, relationship links, raw precision and ledger coverage without false current claims', () => {
		const html = renderToStaticMarkup(
			createElement(BalanceObservationResults, { kind: 'balances', page })
		);
		expect(html).toContain('12.3456789');
		expect(html).toContain('9223372036854775807');
		expect(html).toContain('/explorer/assets/native');
		expect(html).toContain('/explorer/ledgers/63490364');
		expect(html).toContain('/explorer/ledgers/63490360');
		expect(html.replaceAll('<!-- -->', '')).toContain('Observed 63,490,364');
		expect(html.replaceAll('<!-- -->', '')).toContain('Last modified 63,490,360');
		expect(html.replaceAll('<!-- -->', '')).toContain('30,000,000 completed ledgers');
		expect(html.replaceAll('<!-- -->', '')).toContain('1 gap');
		expect(html).toContain('not a frozen snapshot');
		expect(html).toContain('Coverage &amp; precision');
		expect(html).not.toContain('<details open');
	});
	it('links holders to their accounts and keeps empty observations distinct from absence', () => {
		const html = renderToStaticMarkup(
			createElement(BalanceObservationResults, {
				kind: 'holders',
				page: { ...page, rows: [{ ...page.rows[0]!, id: 'GA' }] }
			})
		);
		expect(html).toContain('/explorer/accounts/GA');
		const empty = renderToStaticMarkup(
			createElement(BalanceObservationResults, {
				kind: 'holders',
				page: { ...page, rows: [] }
			})
		);
		expect(empty).toContain('does not establish absence on the current chain');
	});
});
