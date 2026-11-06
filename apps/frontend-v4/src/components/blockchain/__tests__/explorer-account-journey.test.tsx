import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isClassicAccount } from '../../../domain/classic-account';
import type { BalanceObservationRow } from '../../../api/explorer-balance-observations';

const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const origin = '/explorer/operations?source_account=' + account + '&min_ledger=100&max_ledger=101';
jest.unstable_mockModule('next/navigation', () => ({
	usePathname: () => '/explorer/accounts/' + account,
	useSearchParams: () => new URLSearchParams({ return_to: origin })
}));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
const { ExplorerAccountRelations } = await import('../explorer-account-relations');
const { ExplorerInvestigation } = await import('../explorer-investigation');
const { AssetIdentityFilters } = await import('../explorer-asset-identity-filters');
const { formatObservedAmount, observedTrustlineLimit, ObservedAmountSource } = await import('../explorer-observed-amount');

it('gates classic-only links on public-account checksum, not just G-address shape', () => {
	expect(isClassicAccount(account)).toBe(true);
	expect(isClassicAccount('GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE')).toBe(true);
	for (const id of [account.slice(0, -1) + 'A', 'G' + 'A'.repeat(55), 'C' + 'A'.repeat(55), 'M' + 'A'.repeat(68), account.toLowerCase(), '', account + '?']) {
		expect(isClassicAccount(id)).toBe(false);
		expect(renderToStaticMarkup(createElement(ExplorerAccountRelations, { account: id }))).toBe('');
	}
});

it('links to existing issuer/catalogue/funding-operation routes with safe investigation context', () => {
	const html = renderToStaticMarkup(createElement(ExplorerInvestigation, null, createElement(ExplorerAccountRelations, { account })));
	const urls = [...html.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1]!.replaceAll('&amp;', '&'), 'https://explorer.invalid'));
	const issuer = urls.find(url => url.pathname === '/explorer/issuers/' + account)!;
	const assets = urls.find(url => url.pathname === '/explorer/assets')!;
	const creations = urls.find(url => url.pathname === '/explorer/operations' && url.searchParams.has('type'))!;
	expect(issuer.searchParams.get('return_to')).toBe(origin);
	expect(assets.searchParams.get('issuer')).toBe(account);
	expect(assets.searchParams.get('return_to')).toBe(origin);
	expect(creations.searchParams.get('source_account')).toBe(account);
	expect(creations.searchParams.get('type')).toBe('create_account');
	expect(creations.searchParams.get('return_to')).toBe(origin);
	expect(html).toContain('Observed issued assets');
	expect(html).toContain('selected history window');
	expect(html).not.toContain('All created accounts');
});

it('makes issuer and symbol filters visible and independently removable without fetching', () => {
	const remove = jest.fn();
	const tree = AssetIdentityFilters({ query: { issuer: account, symbol: 'KALE' }, busy: false, onRemove: remove });
	const html = renderToStaticMarkup(tree);
	expect(html).toContain(account); expect(html).toContain('KALE');
	expect(html).toContain('Remove issuer filter'); expect(html).toContain('Remove symbol filter');
	expect(html).toContain('/explorer/issuers/' + account); expect(remove).not.toHaveBeenCalled();
	expect(AssetIdentityFilters({ query: {}, busy: false, onRemove: remove })).toBeNull();
});

it('formats human-unit Float64 observations without scaling, truncating precision or erasing tiny values', () => {
	expect(formatObservedAmount(0.0000001)).toBe('0.0000001');
	expect(formatObservedAmount(1234567.1234567)).toBe('1,234,567.1234567');
	for (const value of [1.2345678901234567, 1e-21, 5e-324, -5e-324, -1234567.1234567, 1e21]) {
		expect(Number(formatObservedAmount(value).replaceAll(',', ''))).toBe(value);
		expect(formatObservedAmount(value)).not.toMatch(/[eE]/);
	}
	expect(formatObservedAmount(12345678)).toBe('12,345,678');
});

it('converts only known classic raw trustline limits and preserves original amount/limit evidence', () => {
	const row: BalanceObservationRow = { id: 'USD:' + account, assetType: 'credit_alphanum4', balance: 0.0000001, buyingLiabilities: 1e-21, sellingLiabilities: 1234567.1234567, observedLedger: 100, lastModifiedLedger: 99, trustLineLimit: '9223372036854775807' };
	expect(observedTrustlineLimit(row)).toBe('922,337,203,685.4775807');
	expect(observedTrustlineLimit({ ...row, assetType: undefined })).toBeNull();
	expect(observedTrustlineLimit({ ...row, assetType: 'native' })).toBeNull();
	expect(observedTrustlineLimit({ ...row, id: 'C' + 'A'.repeat(55) })).toBeNull();
	expect(observedTrustlineLimit({ ...row, trustLineLimit: '1.5' })).toBeNull();
	const html = renderToStaticMarkup(createElement(ObservedAmountSource, { row }));
	expect(html).toContain('Float64'); expect(html).toContain('1e-7'); expect(html).toContain('1e-21');
	expect(html).toContain('9223372036854775807'); expect(html).not.toContain('<details open');
});
