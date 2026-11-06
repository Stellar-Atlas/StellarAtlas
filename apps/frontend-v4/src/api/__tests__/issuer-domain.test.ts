import { jest } from '@jest/globals';
import { explorerSearchNavigation, resolveExplorerSearch } from '../explorer-search-route';
import { normalizeIssuerDomain, parseIssuerDomain, requestIssuerDomain } from '../issuer-domain';

const domain = 'example.org';
const issuer = 'GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE';
const asset = { id: 'KALE:' + issuer, code: 'KALE', catalogue: { lastObservedLedger: 42 },
	toml: 'listed', explorer: 'javascript:alert(1)' };
const account = { accountId: issuer, association: 'mismatch', homeDomain: {
	source: 'indexed_account_home_domain', domain: 'other.example', status: 'stale', observedAt: '2026-11-01T08:10:11Z'
}, tomlClaims: ['CURRENCIES'], assets: [asset], assetsTruncated: true,
	links: { account: '//external.invalid/', issuerAssets: '//external.invalid/' } };
const fixture = {
	domain, networkPassphrase: 'Public Global Stellar Network ; September 2015', source: 'cached_issuer_domain_evidence',
	homeDomainIndex: 'partial', catalogue: { status: 'available', generatedAt: '2026-11-01T08:10:11Z' },
	toml: { status: 'stale', accountsIndexed: false, fetchedAt: '2026-11-01T08:10:11Z', url: 'https://example.org/.well-known/stellar.toml' },
	accounts: [account], accountsTruncated: true
};

it('uses the full DNS limit only in explicit mode and restores the finder safely', () => {
	const host = ['A'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.');
	const submitted = host + '.';
	const navigation = explorerSearchNavigation('https://atlas.invalid/explorer?return_to=https://bad.invalid', submitted, 'issuer-domain');
	const result = new URL(navigation!.destination, 'https://atlas.invalid');
	expect(submitted.length).toBe(254);
	expect(result.pathname).toBe('/explorer/issuers/by-domain');
	expect(result.searchParams.get('domain')).toBe(host.toLowerCase());
	const back = new URL(result.searchParams.get('return_to')!, 'https://atlas.invalid');
	expect(back.pathname).toBe('/explorer');
	expect(back.searchParams.get('search_type')).toBe('issuer-domain');
	expect(back.searchParams.get('search')).toBe(submitted);
	expect(back.searchParams.has('return_to')).toBe(false);
	expect(resolveExplorerSearch(submitted)).toBeNull();
	expect(resolveExplorerSearch('example.org')).toBeNull();
	expect(normalizeIssuerDomain(host + 'e')).toBeNull();
});

it.each(['name.xlm', 'NAME.XLM.', 'https://example.org', 'example.org/path', '127.0.0.1', '0x7f.0.0.0x1',
	'-bad.example', 'bad..example', 'example.org:443', 'example%2Eorg', 'éxample.org', 'localhost'])('rejects %s without using another resolver', value => {
	expect(resolveExplorerSearch(value, 'issuer-domain')).toBeNull();
});

it('validates bounded identity and provenance without trusting API-provided links', () => {
	const result = parseIssuerDomain(fixture, domain);
	expect(result.accounts[0]).toMatchObject({ accountId: issuer, association: 'mismatch', assetsTruncated: true,
		homeDomain: { domain: 'other.example', status: 'stale' }, assets: [{ id: asset.id, ledger: 42, toml: 'listed' }] });
	expect(JSON.stringify(result)).not.toMatch(/javascript:|external.invalid/);
	expect(result.accountsTruncated).toBe(true);
	expect(() => parseIssuerDomain(fixture, 'other.example')).toThrow();
	expect(() => parseIssuerDomain({ ...fixture, accounts: Array(26).fill(account) }, domain)).toThrow();
	expect(() => parseIssuerDomain({ ...fixture, accounts: [{ ...account, assets: [{ ...asset, id: 'KALE:elsewhere' }] }] }, domain)).toThrow();
});

it('makes one same-origin abortable request and distinguishes 503 from a broken response', async () => {
	const fetch = jest.spyOn(globalThis, 'fetch');
	const { signal } = new AbortController();
	try {
		fetch.mockResolvedValueOnce(new Response('', { status: 503 }));
		expect(await requestIssuerDomain(domain, signal)).toEqual({ kind: 'unavailable' });
		expect(fetch).toHaveBeenLastCalledWith('/v1/issuer-domains/example.org', expect.objectContaining({ signal, credentials: 'omit' }));
		fetch.mockResolvedValueOnce(new Response('{}'));
		expect(await requestIssuerDomain(domain, signal)).toEqual({ kind: 'error' });
		fetch.mockResolvedValueOnce(Response.json(fixture));
		expect(await requestIssuerDomain(domain, signal)).toMatchObject({ kind: 'ready', evidence: { domain } });
		expect(fetch).toHaveBeenCalledTimes(3);
	} finally { fetch.mockRestore(); }
});
