import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isClassicAccount, isContractAccount } from '../../../domain/classic-account';

const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const contract = 'CA526Y2NQWGWVVQ7RFFPGAZMU66PSYJ3UC2MTVAV4ZU7OM5BOPHDXUSG';
const origin = '/explorer/operations?min_ledger=100&max_ledger=101';
let search = new URLSearchParams({ return_to: origin });
const balanceMount = jest.fn(({ identifier }: { identifier: string }) => createElement('p', null, 'Balance panel ' + identifier));
jest.unstable_mockModule('next/navigation', () => ({
	usePathname: () => '/explorer/accounts/' + contract,
	useSearchParams: () => search
}));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-account-assets.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-balance-observations', () => ({ ExplorerBalanceObservations: balanceMount }));
jest.unstable_mockModule('../blockchain-explorer-results', () => ({ SearchResultView: () => null }));
jest.unstable_mockModule('../explorer-ledger-activity', () => ({ ExplorerLedgerActivity: ({ ledger }: { ledger: string }) => createElement('p', null, 'Ledger activity ' + ledger) }));
const { ExplorerRecordLookup } = await import('../explorer-record-lookup');
const { ExplorerInvestigation } = await import('../explorer-investigation');
beforeEach(() => { balanceMount.mockClear(); search = new URLSearchParams({ return_to: origin }); });
const render = (collection: 'accounts' | 'ledgers', identifier: string) => renderToStaticMarkup(createElement(ExplorerInvestigation, null, createElement(ExplorerRecordLookup, { collection, identifier })));

it('distinguishes checksum-valid G and C encodings without accepting damaged or wrong-kind identities', () => {
	expect(isClassicAccount(account)).toBe(true); expect(isContractAccount(contract)).toBe(true);
	expect(isClassicAccount(contract)).toBe(false); expect(isContractAccount(account)).toBe(false);
	for (const id of [contract.slice(0, -1) + 'A', contract.toLowerCase(), 'C' + 'A'.repeat(55), '', 'M' + 'A'.repeat(68)]) expect(isContractAccount(id)).toBe(false);
});

it.each([account.slice(0, -1) + 'A', 'C' + 'A'.repeat(55), 'not-an-address', 'M' + 'A'.repeat(68)])('does not mount classic requests or filtered actions for invalid identity %s', id => {
	const html = render('accounts', id);
	expect(balanceMount).not.toHaveBeenCalled(); expect(html).toContain('Invalid account address');
	expect(html).toContain('role="alert"'); expect(html).toContain('Search explorer');
	expect(html).not.toContain('source_account='); expect(html).not.toContain('seller='); expect(html).not.toContain('buyer=');
	expect(html).not.toContain('View contract'); expect(html).not.toContain('Balance panel');
});

it('offers only the existing contract-detail destination, preserving return context without a balance mount', () => {
	const html = render('accounts', contract);
	expect(balanceMount).not.toHaveBeenCalled(); expect(html).toContain('Contract balances are not supported in this account view.');
	const href = [...html.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1]!.replaceAll('&amp;', '&'), 'https://explorer.invalid')).find(url => url.pathname === '/explorer/contracts/' + contract)!;
	expect(href.searchParams.get('return_to')).toBe(origin);
	expect(html).not.toContain('source_account='); expect(html).not.toContain('seller='); expect(html).not.toContain('buyer='); expect(html).not.toContain('0 balances');
	search = new URLSearchParams({ return_to: 'https://evil.invalid/explorer' });
	expect(render('accounts', contract)).not.toContain('evil.invalid');
});

it('uses current-account balances by default and preserves existing classic/issuer actions', () => {
	const html = render('accounts', account);
	expect(balanceMount).not.toHaveBeenCalled();
	expect(html).toContain('Horizon account balances');
	expect(html.match(/>Federation name<\/h2>/g)).toHaveLength(1);
	expect(html).toContain('Indexed observations');
	expect(html).toContain('source_account=' + account); expect(html).toContain('seller=' + account); expect(html).toContain('buyer=' + account);
	expect(html).toContain('/explorer/issuers/' + account); expect(html).toContain('Observed issued assets');
	expect(html).not.toContain('Invalid account address');
});

it('restores an indexed wallet continuation without mounting the current account lane', () => {
	search.set('wallet_for', account);
	search.set('wallet_after', 'opaque');
	const html = render('accounts', account);
	expect(balanceMount).toHaveBeenCalledTimes(1); expect(html).toContain('Balance panel ' + account);
	expect(balanceMount.mock.calls[0]?.[0]).toMatchObject({ identifier: account, autoLoad: true, kind: 'balances' });
	expect(html).not.toContain('Horizon account balances');
});

it('leaves ledger lookup behavior outside the account guard', () => {
	const html = render('ledgers', '100');
	expect(balanceMount).not.toHaveBeenCalled(); expect(html).toContain('Ledger activity 100'); expect(html).not.toContain('Invalid account address');
});
