import { assetDirectoryLink } from '../asset-directory-link';
import { assetDiscoveryHref, assetDiscoveryQueryKey } from '../asset-discovery-page';

const from = (origin: string, child = '') => new URLSearchParams(child + '&' + new URLSearchParams({ return_to: origin }));
describe('asset detail directory link', () => {
	it('opens a clean directory, not a child event/state search or window', () => {
		expect(assetDirectoryLink(new URLSearchParams())).toBe('/explorer/assets');
		expect(assetDirectoryLink(new URLSearchParams('tab=contracts-events&activity=state&q=100&after=event&state_offset=25&state_for=x&offset=25&min_ledger=100&max_ledger=101&ledger_key_hash=key&deleted=false&order=asc&limit=25'))).toBe('/explorer/assets');
	});
	it('restores only the validated directory origin, including bound continuation and issuer filters', () => {
		const query = { q: 'USD', issuer: 'G' + 'A'.repeat(55), min_ledger: '100', max_ledger: '101' };
		const origin = assetDiscoveryHref('', { query, cursor: 'opaque_cursor' });
		expect(assetDirectoryLink(from(origin, 'q=event-search&min_ledger=999&ledger_key_hash=key&after=event'))).toBe(origin);
		expect(new URL(origin, 'https://example.invalid').searchParams.get('cursor_for')).toBe(assetDiscoveryQueryKey(query));
	});
	it('restores a bare-code discovery origin without treating an asset identity as a directory', () => {
		expect(assetDirectoryLink(from('/explorer/assets/KALE?min_ledger=100'))).toBe('/explorer/assets?q=KALE&min_ledger=100');
		const detail = '/explorer/assets/USD%3AG' + 'A'.repeat(55);
		expect(new URL(assetDirectoryLink(from(detail)), 'https://example.invalid').searchParams.get('return_to')).toBe(detail);
	});
	it('preserves issuer-origin return without inventing asset filters from the child', () => {
		const issuer = '/explorer/issuers/G' + 'A'.repeat(55) + '?q=issuer.example';
		const target = new URL(assetDirectoryLink(from(issuer, 'q=event-search&topic=mint')), 'https://example.invalid');
		expect([...target.searchParams]).toEqual([['return_to', issuer]]);
	});
	it('rejects external and malformed directory origins without weakening discovery validation', () => {
		for (const origin of ['https://evil.invalid', '//evil.invalid', '/explorer/assets?ledger_key_hash=key', '/explorer/assets?q=A&q=B', '/explorer/assets?q=A&cursor=unbound', '/explorer/assets?min_ledger=102&max_ledger=101'])
			expect(assetDirectoryLink(from(origin, 'q=event-search'))).toBe('/explorer/assets');
	});
});
