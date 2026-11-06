import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Networks, StrKey } from '@stellar/stellar-sdk';
import express from 'express';
import request from 'supertest';
import { AssetCatalogue } from '../../asset-catalogue/AssetCatalogue.js';
import { AssetCatalogueSource } from '../../asset-catalogue/AssetCatalogueSource.js';
import { classicAsset } from '../../asset-catalogue/AssetIdentity.js';
import * as metadataValues from '../../asset-metadata/AssetMetadataValues.js';
import { parseIssuerToml } from '../../asset-metadata/parseIssuerToml.js';
import { IssuerDomainCache } from '../IssuerDomainCache.js';
import { IssuerDomainLookup } from '../IssuerDomainLookup.js';
import { issuerDomainRouter } from '../IssuerDomainRouter.js';

// Keep the metadata write fixture independent of free space on the test host.
const moduleJest = (
	import.meta as ImportMeta & {
		jest: { unstable_mockModule(name: string, factory: () => object): void };
	}
).jest;
moduleJest.unstable_mockModule(
	'../../asset-metadata/AssetMetadataValues.js',
	() => ({
		...metadataValues,
		assertCacheSpace: (path: string, bytes: number) =>
			metadataValues.assertCacheSpace(path, bytes, async () => ({
				bsize: 1024 * 1024,
				blocks: 1000,
				bavail: 500
			}))
	})
);
const { AssetMetadataService } =
	await import('../../asset-metadata/AssetMetadataService.js');

const domain = 'issuer.example';
const network = Networks.PUBLIC;
const now = Date.parse('2026-11-04T18:00:00Z');
const observedAt = new Date(now - 60_000).toISOString();
const account = (seed: number) =>
	StrKey.encodeEd25519PublicKey(Buffer.alloc(32, seed));
const [first, second, different, tomlOnly, subdomain, otherNetwork] = [
	1, 2, 3, 4, 5, 6
].map(account) as [string, string, string, string, string, string];
let root: string;

// Golden SHA-256 filenames for the public network identifier, newline and key.
const mainnetIssuerFiles = new Map([
	[first, 'ee99ec387233fb937416eb6a0c8d865bfe3cb987efd74bde8e01b7b0ca76a7cc'],
	[second, 'ba263d5ed2992027cd31c5d54f81aa09c13195ea7ea04b3dde7b17d974bf68f2'],
	[different, '252b32a2b786d05f7a530a1348ec62de3cdde01aebfcc7ede52427e3d27d6961'],
	[subdomain, 'bd0ff5aa81cbe8fcca4cc88e10773f2650b14a2ca70e2a5b912240c2e8affceb']
]);
const testnetIssuerFiles = new Map([
	[otherNetwork, 'f5b6a2262add2ce23a34009f8d23ee17570aa1482293c263b24518572f6d3dae']
]);
const mainnetTomlFile = 'd896b3973105282572c16e6d5232e4b085abca58654135dd3ddbaa4cf43d295e';

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'issuer-domain-fixture-'));
	await mkdir(join(root, 'issuer-domains'));
	await mkdir(join(root, 'issuers'));
});

afterEach(async () => {
	jest.restoreAllMocks();
	await rm(root, { recursive: true, force: true });
});

function save(folder: string, fileKey: string, data: object) {
	return writeFile(join(root, folder, fileKey + '.json'), JSON.stringify(data));
}

function home(
	issuer: string,
	homeDomain: string,
	options: { testnet?: boolean; error?: boolean; fetchedAt?: string } = {}
) {
	const fileKey = (options.testnet ? testnetIssuerFiles : mainnetIssuerFiles).get(issuer);
	if (!fileKey) throw new Error('No golden filename for issuer fixture');
	return save('issuer-domains', fileKey, {
		issuer,
		homeDomain,
		fetchedAt: options.fetchedAt ?? observedAt,
		lastAttemptAt: observedAt,
		error: options.error ?? false
	});
}

function toml(source: string, overrides: object = {}) {
	const parsed = parseIssuerToml(source);
	return save('issuers', mainnetTomlFile, {
		...parsed,
		homeDomain: domain,
		tomlUrl: 'https://' + domain + '/.well-known/stellar.toml',
		networkPassphrase: network,
		fetchedAt: observedAt,
		lastAttemptAt: observedAt,
		error: null,
		...overrides
	});
}

function observed(code: string, issuer: string) {
	return {
		...classicAsset(code, issuer, network),
		firstObservedLedger: 95,
		lastObservedLedger: 110,
		firstObservedAt: observedAt,
		lastObservedAt: observedAt
	};
}

function fixture(assets: readonly ReturnType<typeof observed>[] = []) {
	const cache = new IssuerDomainCache(root, network);
	const index = jest.spyOn(cache, 'readIndexedDomains');
	const catalogue = {
		cachedIssuerObservationsSnapshot: jest.fn(() => ({
			generatedAt: observedAt,
			assets
		}))
	};
	const lookup = new IssuerDomainLookup(cache, catalogue, () => now);
	return {
		app: express().use('/v1', issuerDomainRouter(network, lookup)),
		lookup,
		index,
		catalogue
	};
}

test('combines exact indexed home domains with attributed TOML accounts and assets', async () => {
	await Promise.all([
		home(first, 'Issuer.Example'),
		home(second, domain),
		home(different, 'other.example'),
		home(subdomain, 'sub.' + domain),
		home(otherNetwork, domain, { testnet: true }),
		toml(`ACCOUNTS = ["${first}", "${different}", "${tomlOnly}", "invalid"]
[[CURRENCIES]]
code = "USD"
issuer = "${first}"
[[CURRENCIES]]
code = "USD"
issuer = "${different}"
[[CURRENCIES]]
code = "FAKE"
issuer = "invalid"
`)
	]);
	const fetch = jest.spyOn(globalThis, 'fetch');
	const { app, index, catalogue } = fixture([
		observed('USD', first),
		observed('EUR', first),
		observed('USD', second),
		observed('JPY', different)
	]);
	const result = await request(app)
		.get('/v1/issuer-domains/ISSUER.EXAMPLE.')
		.expect(200);
	expect(result.headers['cache-control']).toBe('no-store');
	expect(result.body).toMatchObject({
		domain,
		networkPassphrase: network,
		homeDomainIndex: 'available',
		accountsTruncated: false,
		toml: { status: 'available', fetchedAt: observedAt, accountsIndexed: true }
	});
	expect(result.body.accounts).toHaveLength(4);
	expect(result.body.accounts).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				accountId: first,
				association: 'corroborated',
				tomlClaims: ['ACCOUNTS', 'CURRENCIES'],
				homeDomain: {
					source: 'indexed_account_home_domain',
					domain,
					observedAt,
					status: 'observed'
				},
				assets: [
					expect.objectContaining({
						id: 'EUR:' + first,
						toml: 'not_listed',
						catalogue: { lastObservedLedger: 110 }
					}),
					expect.objectContaining({
						id: 'USD:' + first,
						toml: 'listed',
						catalogue: { lastObservedLedger: 110 }
					})
				]
			}),
			expect.objectContaining({
				accountId: second,
				association: 'indexed_only',
				tomlClaims: []
			}),
			expect.objectContaining({
				accountId: different,
				association: 'mismatch',
				homeDomain: expect.objectContaining({ domain: 'other.example' }),
				assets: [
					expect.objectContaining({
						id: 'USD:' + different,
						toml: 'listed',
						catalogue: null
					})
				]
			}),
			expect.objectContaining({
				accountId: tomlOnly,
				association: 'toml_only',
				homeDomain: null,
				assets: []
			})
		])
	);
	await request(app).get('/v1/issuer-domains/sub.issuer.example').expect(200);
	expect(index).toHaveBeenCalledTimes(1);
	expect(catalogue.cachedIssuerObservationsSnapshot).toHaveBeenCalledTimes(1);
	expect(fetch).not.toHaveBeenCalled();
});

test('distinguishes absent, old and failed evidence from current TOML corroboration', async () => {
	await home(first, domain, { error: true });
	const { app } = fixture([observed('USD', first)]);
	const absent = await request(app)
		.get('/v1/issuer-domains/' + domain)
		.expect(200);
	expect(absent.body).toMatchObject({
		toml: { status: 'unavailable', fetchedAt: null },
		accounts: [
			{
				accountId: first,
				association: 'unavailable',
				homeDomain: { status: 'stale' }
			}
		]
	});
	await toml(`ACCOUNTS = ["${first}", "${tomlOnly}"]`, {
		fetchedAt: '2026-11-01T18:00:00Z'
	});
	const stale = await request(app)
		.get('/v1/issuer-domains/' + domain)
		.expect(200);
	expect(stale.body.toml).toMatchObject({
		status: 'stale',
		fetchedAt: '2026-11-01T18:00:00.000Z'
	});
	expect(stale.body.accounts).toHaveLength(1);
	expect(stale.body.accounts[0].tomlClaims).toEqual([]);
	await toml('', { error: 'Issuer TOML returned HTTP 404' });
	const failed = await request(app)
		.get('/v1/issuer-domains/' + domain)
		.expect(200);
	expect(failed.body.toml).toMatchObject({
		status: 'unavailable',
		fetchedAt: null
	});
});

test('reads legacy cached currency claims and rejects TOML bound to another network or host', async () => {
	const { app } = fixture();
	const source = `[[CURRENCIES]]\ncode = "USD"\nissuer = "${first}"`;
	await toml(source, { accounts: undefined });
	const legacy = await request(app)
		.get('/v1/issuer-domains/' + domain)
		.expect(200);
	expect(legacy.body).toMatchObject({
		toml: { accountsIndexed: false, status: 'available' },
		accounts: [
			{ accountId: first, association: 'toml_only', tomlClaims: ['CURRENCIES'] }
		]
	});
	for (const overrides of [
		{ networkPassphrase: Networks.TESTNET },
		{ tomlUrl: 'https://other.example/.well-known/stellar.toml' }
	]) {
		await toml(source, overrides);
		const mismatch = await request(app)
			.get('/v1/issuer-domains/' + domain)
			.expect(200);
		expect(mismatch.body).toMatchObject({
			toml: { status: 'unavailable' },
			accounts: []
		});
	}
});

test('bounds both result dimensions and keeps indexed matches ahead of TOML-only claims', async () => {
	await home(first, domain);
	const claims = Array.from({ length: 30 }, (_, i) => account(i + 32));
	await toml('ACCOUNTS = ' + JSON.stringify(claims));
	const assets = Array.from({ length: 30 }, (_, i) => observed('T' + i, first));
	const { app } = fixture(assets);
	const result = await request(app)
		.get('/v1/issuer-domains/' + domain)
		.expect(200);
	expect(result.body.accountsTruncated).toBe(true);
	expect(result.body.accounts).toHaveLength(25);
	expect(result.body.accounts[0]).toMatchObject({
		accountId: first,
		assetsTruncated: true
	});
	expect(result.body.accounts[0].assets).toHaveLength(20);
});

test('the existing metadata refresh upgrades legacy documents and persists validated ACCOUNTS', async () => {
	await toml('', {
		accounts: undefined,
		logoFiles: {},
		etag: '"legacy"',
		fetchedAt: '2026-11-01T18:00:00Z',
		lastAttemptAt: '2026-11-01T18:00:00Z'
	});
	const requestImpl = jest.fn(
		async (
			_url: string,
			_headers: Readonly<Record<string, string>>,
			_maxBytes: number
		) => ({
			status: 200,
			headers: { etag: '"fresh"' },
			body: Buffer.from(`ACCOUNTS = ["${first}", "${first}", "invalid"]`)
		})
	);
	const service = new AssetMetadataService({
		cacheRoot: root,
		networkPassphrase: network,
		resolveIssuerHomeDomain: async () => domain,
		requestImpl,
		now: () => now
	});
	await expect(service.ensureIssuerMetadata(first)).resolves.toMatchObject({
		accounts: [first]
	});
	expect(requestImpl).toHaveBeenCalledWith(
		'https://' + domain + '/.well-known/stellar.toml',
		{},
		100 * 1024
	);
	const { app } = fixture();
	const response = await request(app)
		.get('/v1/issuer-domains/' + domain)
		.expect(200);
	expect(response.body.accounts).toMatchObject([
		{ accountId: first, association: 'corroborated', tomlClaims: ['ACCOUNTS'] }
	]);
	expect(requestImpl).toHaveBeenCalledTimes(1);
});

test('marks an unreadable cache entry as incomplete instead of claiming complete coverage', async () => {
	await home(first, domain);
	await writeFile(join(root, 'issuer-domains', 'a'.repeat(64) + '.json'), '{');
	const { app } = fixture();
	const response = await request(app)
		.get('/v1/issuer-domains/' + domain)
		.expect(200);
	expect(response.body).toMatchObject({
		homeDomainIndex: 'partial',
		accounts: [{ accountId: first }]
	});
});

test('recovers a real writer’s trailing-dot cache record for equivalent DNS requests', async () => {
	const writtenHost = domain.toUpperCase() + '.';
	const requestImpl = jest.fn(async () => ({
		status: 200,
		headers: {},
		body: Buffer.from(`ACCOUNTS = ["${first}"]`)
	}));
	const service = new AssetMetadataService({
		cacheRoot: root,
		networkPassphrase: network,
		resolveIssuerHomeDomain: async () => writtenHost,
		requestImpl,
		now: () => now
	});
	await expect(service.ensureIssuerMetadata(first)).resolves.toMatchObject({
		homeDomain: writtenHost,
		tomlUrl: 'https://' + domain + './.well-known/stellar.toml'
	});
	const { app } = fixture();
	for (const spelling of [domain, writtenHost]) {
		const response = await request(app)
			.get('/v1/issuer-domains/' + spelling)
			.expect(200);
		expect(response.body).toMatchObject({
			domain,
			toml: {
				status: 'available',
				url: 'https://' + domain + './.well-known/stellar.toml'
			},
			accounts: [{ accountId: first, association: 'corroborated' }]
		});
	}
	expect(requestImpl).toHaveBeenCalledTimes(1);
});

test('issuer lookup never starts a real cold catalogue load and uses the same instance when warm', async () => {
	await home(first, domain);
	const catalogueRoot = join(root, 'catalogue');
	await mkdir(catalogueRoot);
	await writeFile(
		join(catalogueRoot, 'catalogue.json'),
		JSON.stringify({
			version: 1,
			generatedAt: observedAt,
			watermark: 'fixture',
			maximumObservedLedger: 110,
			assets: [observed('USD', first)]
		})
	);
	const source = new AssetCatalogueSource(network, {
		HUBBLE_CLICKHOUSE_URL: 'http://unused.invalid'
	});
	const refresh = jest.spyOn(source, 'refresh');
	const catalogue = new AssetCatalogue(source, catalogueRoot, network);
	const load = jest.spyOn(catalogue, 'load');
	let clock = now;
	const lookup = new IssuerDomainLookup(
		new IssuerDomainCache(root, network),
		catalogue,
		() => clock
	);
	const app = express().use('/v1', issuerDomainRouter(network, lookup));
	const cold = await request(app)
		.get('/v1/issuer-domains/' + domain)
		.expect(200);
	expect(cold.body).toMatchObject({
		catalogue: { generatedAt: null, status: 'unavailable' },
		accounts: [{ accountId: first, assets: [] }]
	});
	expect(load).not.toHaveBeenCalled();
	await catalogue.load(); // Existing owner warm-up, outside either domain request.
	clock += 61_000;
	const warm = await request(app)
		.get('/v1/issuer-domains/' + domain)
		.expect(200);
	expect(warm.body).toMatchObject({
		catalogue: { generatedAt: observedAt, status: 'available' },
		accounts: [{ accountId: first, assets: [{ id: 'USD:' + first }] }]
	});
	expect(load).toHaveBeenCalledTimes(1);
	expect(refresh).not.toHaveBeenCalled();
});

test('coalesces the cold index read and rejects excess concurrent lookups', async () => {
	const { app, lookup, index } = fixture();
	const gate =
		Promise.withResolvers<
			Awaited<ReturnType<IssuerDomainCache['readIndexedDomains']>>
		>();
	index.mockReturnValueOnce(gate.promise);
	const pending = Promise.all(
		Array.from({ length: 8 }, () => lookup.lookup(domain))
	);
	try {
		const busy = await request(app)
			.get('/v1/issuer-domains/' + domain)
			.expect(503);
		expect(busy.headers['retry-after']).toBe('5');
		expect(index).toHaveBeenCalledTimes(1);
	} finally {
		gate.resolve({
			status: 'available',
			byAccount: new Map(),
			byDomain: new Map()
		});
		await pending;
	}
});

test.each([
	'127.0.0.1',
	'127.0.0.0x1',
	'foo.0x10',
	'localhost',
	'mate.xlm',
	'a..example',
	'K.example',
	'https://issuer.example',
	'issuer.example:443',
	'name@issuer.example'
])(
	'rejects unsupported lookup input %s before opening the index',
	async (value) => {
		const { app, index } = fixture();
		await request(app)
			.get('/v1/issuer-domains/' + encodeURIComponent(value))
			.expect(400);
		expect(index).not.toHaveBeenCalled();
	}
);
