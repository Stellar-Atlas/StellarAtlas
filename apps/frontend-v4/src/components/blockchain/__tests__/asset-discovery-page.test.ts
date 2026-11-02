import { assetDiscoveryHref, assetDiscoveryKey, assetDiscoveryPath, assetDiscoveryQueryKey, parseAssetDiscoveryPage, readAssetDiscoverySelection, validateAssetDiscoveryQuery } from '../asset-discovery-page';
import type { ExplorerFilters } from '../../../api/explorer-analytics';
import { isAssetDiscoveryReference, normalizeAssetRef } from '../asset-data';
const issuer = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', contract = 'C' + 'A'.repeat(55);
const query = { q: 'KALE', symbol: 'KALE', issuer, min_ledger: '99', max_ledger: '101', start_time: '2026-11-01T01:00:00.000Z', end_time: '2026-11-02T01:00:00.000Z' };
const page = { data: [{ id: 'native', kind: 'native', code: 'XLM', issuer: null }, { id: 'KALE:' + issuer, kind: 'classic', code: 'KALE', issuer, contractId: contract, logoUrl: '/v1/asset-logos/test.png' }, { id: contract, kind: 'contract', contractId: contract }], nextCursor: 'next_page', generatedAt: '2026-11-02T01:00:00Z', coverage: { catalogueReady: true } };
it('preserves all supported server filters while separating page context and fixing the API limit at25', () => {
	const selection = { query, cursor: 'next_page' };
	const href = assetDiscoveryHref('?return_to=%2Fexplorer&tab=markets&market_trade_min=2&limit=100', selection, '#assets');
	const url = new URL(href, 'https://explorer.invalid');
	expect(readAssetDiscoverySelection(url.searchParams)).toEqual(selection);
	expect(url.searchParams.get('return_to')).toBe('/explorer'); expect(url.searchParams.get('tab')).toBe('markets'); expect(url.hash).toBe('#assets');
	const path = new URL(assetDiscoveryPath({ ...selection, query: { ...query, return_to: '/explorer', tab: 'markets', limit: '100' } }), url);
	expect(path.searchParams.get('limit')).toBe('25'); expect(path.searchParams.get('cursor')).toBe('next_page');
	for (const [key, value] of Object.entries(query)) expect(path.searchParams.get(key)).toBe(value);
	for (const key of ['return_to', 'tab', 'market_trade_min', 'cursor_for']) expect(path.searchParams.has(key)).toBe(false);
});
it('binds opaque cursors to the complete selection, and preserves bare-symbol/native/contract query resolution', () => {
	const params = new URLSearchParams({ ...query, cursor: 'next_page', cursor_for: assetDiscoveryQueryKey(query) });
	expect(readAssetDiscoverySelection(params).cursor).toBe('next_page');
	params.set('max_ledger', '102'); expect(() => readAssetDiscoverySelection(params)).toThrow('does not match');
	expect(() => readAssetDiscoverySelection(new URLSearchParams('q=A&q=B'))).toThrow('repeat');
	expect(() => readAssetDiscoverySelection(new URLSearchParams('cursor=bad!'))).toThrow();
	expect(readAssetDiscoverySelection(new URLSearchParams(), 'KALE').query.q).toBe('KALE');
	expect(() => readAssetDiscoverySelection(new URLSearchParams('q=KALE&asset_code=USD'))).toThrow('Unsupported asset search parameter');
	expect(() => assetDiscoveryPath({ query: { q: 'KALE', typo: 'USD' }, cursor: null })).toThrow('Unsupported asset search parameter');
	const reapplied = new URL(assetDiscoveryHref('?asset_code=USD&tab=markets&holder_sort=balance&return_to=%2Fexplorer', { query: { q: 'KALE' }, cursor: null }), 'https://explorer.invalid');
	expect(reapplied.searchParams.has('asset_code')).toBe(false); expect(reapplied.searchParams.get('holder_sort')).toBe('balance');
	expect(readAssetDiscoverySelection(reapplied.searchParams).query.q).toBe('KALE');
	for (const q of ['native', contract, 'KALE:' + issuer]) expect(new URL(assetDiscoveryPath({ query: { q }, cursor: null }), 'https://explorer.invalid').searchParams.get('q')).toBe(q);
	expect(assetDiscoveryKey({ query, cursor: null })).not.toBe(assetDiscoveryKey({ query, cursor: 'next_page' }));
});
it('rejects invalid ranges rather than widening them or normalizing impossible calendar dates', () => {
	const invalidInputs: ExplorerFilters[] = [{ min_ledger: '10', max_ledger: '9' }, { min_ledger: '0' }, { max_ledger: '4294967296' }, { issuer: 'not-an-issuer' }, { start_time: '2026-02-30T00:00:00Z' }, { start_time: '2026-11-02T01:00:00Z', end_time: '2026-11-02T01:00:00Z' }];
	for (const input of invalidInputs) expect(() => validateAssetDiscoveryQuery(input)).toThrow();
	expect(validateAssetDiscoveryQuery({ min_ledger: '00099', max_ledger: '00101' })).toEqual({ min_ledger: '99', max_ledger: '101' });
	expect(validateAssetDiscoveryQuery({ start_time: '2026-11-01T01:30:00-05:00' }).start_time).toBe('2026-11-01T06:30:00.000Z');
});
it('retains native, classic and contract identities/logos and distinguishes unavailable from validempty', () => {
	const result = parseAssetDiscoveryPage(page, null);
	expect(result.data.map(asset => asset.id)).toEqual(['native', 'KALE:' + issuer, contract]);
	expect(result.data[1]?.logoUrl).toBe('/v1/asset-logos/test.png');
	expect(parseAssetDiscoveryPage({ ...page, data: [], nextCursor: null }, null).catalogueReady).toBe(true);
	expect(parseAssetDiscoveryPage({ ...page, data: [], nextCursor: null, generatedAt: null, coverage: { catalogueReady: false } }, null).catalogueReady).toBe(false);
	for (const malformed of [{ ...page, data: Array(26).fill(page.data[0]) }, { ...page, data: [page.data[0], page.data[0]] }, { ...page, nextCursor: 'bad!' }, { ...page, coverage: {} }]) expect(() => parseAssetDiscoveryPage(malformed, null)).toThrow();
	expect(() => parseAssetDiscoveryPage(page, 'next_page')).toThrow();
});
it('shares server/client classification without losing encoded issued assets or direct native/contract identities', () => {
	expect(normalizeAssetRef('USD%3A' + issuer)).toBe('USD:' + issuer);
	for (const reference of ['native', contract, 'USD:' + issuer, 'USD%3A' + issuer]) expect(isAssetDiscoveryReference(normalizeAssetRef(reference))).toBe(false);
	for (const reference of [undefined, 'A', issuer]) expect(isAssetDiscoveryReference(normalizeAssetRef(reference))).toBe(true);
});
