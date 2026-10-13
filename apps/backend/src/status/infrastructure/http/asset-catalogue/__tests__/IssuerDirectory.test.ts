import { Networks } from '@stellar/stellar-sdk';
import { IssuerDirectory } from '../IssuerDirectory.js';
import { classicAsset, nativeAsset } from '../AssetIdentity.js';

const issuerA = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const issuerB = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

function observed(code: string, issuer: string, first: number, last: number) {
	return {
		...classicAsset(code, issuer, Networks.PUBLIC),
		firstObservedLedger: first,
		lastObservedLedger: last,
		firstObservedAt: '2025-01-01T00:00:00.000Z',
		lastObservedAt: '2025-01-02T00:00:00.000Z'
	};
}

test('issuer directory groups catalogue facts, filters by cached domain or address, and pages stably', async () => {
	const assets = [
		observed('USDC', issuerA, 20, 80),
		observed('EURC', issuerA, 10, 100),
		observed('USD', issuerB, 200, 300),
		nativeAsset(Networks.PUBLIC)
	];
	let generatedAt = '2026-10-13T00:00:00.000Z';
	const catalogue = {
		issuerObservationsSnapshot: async () => ({
			generatedAt,
			assets
		})
	};
	const cachedDomains = new Map<string, string | null>([[issuerA, 'circle.com']]);
	let resolveDomains!: (domains: ReadonlyMap<string, string | null>) => void;
	const pendingDomains = new Promise<ReadonlyMap<string, string | null>>((resolve) => {
		resolveDomains = resolve;
	});
	const getCachedIssuerHomeDomains = jest.fn(() => pendingDomains);
	const directory = new IssuerDirectory(
		catalogue as never,
		{ getCachedIssuerHomeDomains } as never
	);

	const addressPrefix = await directory.search({ q: issuerB.slice(0, 8), limit: 10 });
	expect(addressPrefix.data[0]).toMatchObject({ id: issuerB, homeDomain: null });
	let domainSearchSettled = false;
	const domainSearch = directory.search({ q: 'CIRCLE', limit: 10 }).then((result) => {
		domainSearchSettled = true;
		return result;
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(domainSearchSettled).toBe(false);
	resolveDomains(cachedDomains);
	let page = await domainSearch;
	expect(page.domainsReady).toBe(true);
	expect(page.data[0]).toMatchObject({
		id: issuerA,
		homeDomain: 'circle.com',
		assetCount: 2,
		firstObservedLedger: 10,
		lastObservedLedger: 100,
		links: {
			self: '/v1/issuers/' + issuerA,
			assets: '/v1/issuers/' + issuerA + '/assets',
			explorer: '/explorer/issuers/' + issuerA
		}
	});
	expect(page.data.map((row) => row.id)).toEqual([issuerA]);
	expect(getCachedIssuerHomeDomains).toHaveBeenCalledTimes(1);

	cachedDomains.clear();
	generatedAt = '2026-10-13T00:01:00.000Z';
	page = await directory.search({ limit: 1 });
	resolveDomains(cachedDomains);
	for (let attempt = 0; !page.domainsReady && attempt < 20; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 2));
		page = await directory.search({ limit: 1 });
	}
	expect(page.data.find((row) => row.id === issuerA)?.homeDomain).toBe('circle.com');
	expect(getCachedIssuerHomeDomains).toHaveBeenCalledTimes(2);

	const first = await directory.search({ limit: 1 });
	expect(first.nextCursor).toEqual(expect.any(String));
	const second = await directory.search({ limit: 1, cursor: first.nextCursor! });
	expect(second.data).toHaveLength(1);
	expect(second.data[0]!.id).not.toBe(first.data[0]!.id);
	expect(second.data[0]!.homeDomain).toBeNull();
	expect((await directory.search({ q: issuerB.slice(0, 8), limit: 10 })).data[0]).toMatchObject({
		id: issuerB,
		homeDomain: null,
		assetCount: 1
	});
	await expect(directory.search({ q: 'circle', limit: 1, cursor: first.nextCursor! }))
		.rejects.toThrow('Invalid issuer cursor');
});
