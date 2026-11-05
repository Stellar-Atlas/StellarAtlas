import { jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCurrentAccount } from '../../../api/explorer-current-account';

jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-account-assets.module.css', () => ({ default: {} }));
const { AccountAssetIdentity } = await import('../explorer-account-asset-identity');
const { CurrentAccountInventory } = await import('../explorer-account-assets');
const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const issuer = 'GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE';
const credit = { asset_type: 'credit_alphanum4', asset_code: 'USD', asset_issuer: issuer };

it('parses exact Horizon units, rejects float or wrong account data, and keeps zero trustlines in the inventory', () => {
	const balances = [
		{ asset_type: 'native', balance: '922337203685.4775807' },
		{ ...credit, balance: '0.0000000', limit: '922337203685.4775807', is_authorized: false },
		{ ...credit, asset_code: 'EUR', balance: '0.0000001' }
	];
	const current = parseCurrentAccount(account, { account_id: account, balances, last_modified_ledger: 100 });
	expect(current.balances.map(row => row.balance)).toEqual([9223372036854775807n, 0n, 1n]);
	expect(current.balances[1]).toMatchObject({ limit: 9223372036854775807n, authorization: 'restricted' });
	expect(() => parseCurrentAccount(account, { account_id: issuer, balances })).toThrow();
	expect(() => parseCurrentAccount(account, { account_id: account, balances: [] })).toThrow();
	expect(() => parseCurrentAccount(account, { account_id: account, balances: [{ ...credit, balance: 0.1 }] })).toThrow();
	expect(() => parseCurrentAccount(account, { account_id: account, balances: [{ ...credit, balance: '922337203685.4775808' }] })).toThrow();
	const html = renderToStaticMarkup(<CurrentAccountInventory value={current} />);
	expect(html).toContain('922,337,203,685.4775807');
	expect(html).toContain('0.0000001');
	expect(html).toContain('Current assets');
	expect(html).not.toContain('/assets/USD');
});

it('uses cached same-origin images only, explicitly attributes the name, and links the full issuer', () => {
	const asset = { id: 'USD:' + issuer, code: 'USD', issuer };
	const logo = '/v1/asset-logos/' + 'a'.repeat(64) + '.png';
	const html = renderToStaticMarkup(<AccountAssetIdentity asset={asset} metadata={{ logoUrl: logo, name: 'Issuer text' }} />);
	expect(html).toContain(logo);
	expect(html.replaceAll('<!-- -->', '')).toContain('Issuer name: Issuer text');
	expect(html).toContain('/explorer/accounts/' + issuer);
	expect(renderToStaticMarkup(<AccountAssetIdentity asset={asset} metadata={{ logoUrl: '//third-party.invalid/logo' }} />)).not.toContain('<img');
});
