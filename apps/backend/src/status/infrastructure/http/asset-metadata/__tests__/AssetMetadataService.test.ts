import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetMetadataService } from '../AssetMetadataService.js';
import { parseIssuerToml } from '../parseIssuerToml.js';
import { validatePublicHttpsUrl } from '../safeHttp.js';
import { assertCacheSpace, removeExpiredLock } from '../AssetMetadataValues.js';
import type { SafeResponse } from '../safeHttp.js';

const issuer = `G${'A'.repeat(55)}`;
const toml = `[[CURRENCIES]]
code = "USD"
issuer = "${issuer}"
name = "Dollar One"

[[CURRENCIES]]
code = "USD"
issuer = "G${'B'.repeat(55)}"
name = "Dollar Two"
`;
const ok = (body: string): SafeResponse => ({
	status: 200,
	headers: { etag: '"v1"' },
	body: Buffer.from(body)
});

test('protects the filesystem reserve after including incoming cache bytes', async () => {
	const ampleTotal = async () => ({
		bsize: 1024 * 1024,
		blocks: 1000,
		bavail: 120
	});
	await expect(
		assertCacheSpace('/synthetic', 20 * 1024 * 1024, ampleTotal)
	).rejects.toThrow('metadata cache low on space');
	await expect(
		assertCacheSpace('/synthetic', 19 * 1024 * 1024, ampleTotal)
	).resolves.toBeUndefined();
	const smallTotal = async () => ({
		bsize: 1024 * 1024,
		blocks: 100,
		bavail: 80
	});
	await expect(
		assertCacheSpace('/synthetic', 17 * 1024 * 1024, smallTotal)
	).rejects.toThrow('metadata cache low on space');
	await expect(
		assertCacheSpace('/synthetic', 15 * 1024 * 1024, smallTotal)
	).resolves.toBeUndefined();
});

describe('asset metadata pipeline', () => {
	let root: string;
	afterEach(async () => {
		if (root) await rm(root, { recursive: true, force: true });
	});

	test('parses multiple currencies and exact code/issuer lookup', async () => {
		const parsed = parseIssuerToml(toml);
		expect(parsed.currencies).toHaveLength(2);
		root = await mkdtemp(join(tmpdir(), 'asset-metadata-'));
		const service = new AssetMetadataService({
			cacheRoot: root,
			networkPassphrase: 'test-network',
			resolveIssuerHomeDomain: async () => 'issuer.example',
			requestImpl: async () => ok(toml)
		});
		const match = await service.ensureAssetMetadata({
			id: 'USD:G...A',
			code: 'USD',
			issuer
		});
		expect(match.status).toBe('ready');
		expect(match.name).toBe('Dollar One');
		const mismatch = await service.getAssetMetadata({
			id: 'USD:G...A',
			code: 'USDC',
			issuer
		});
		expect(mismatch.status).toBe('unavailable');
	});

	test('preserves exact matched currency claims and nested ORG claims as strings', async () => {
		root = await mkdtemp(join(tmpdir(), 'asset-metadata-'));
		const hostileClaim = '<script>alert(issuer)</script> ';
		const claimedToml = `ORG_NAME = "Root Org"
[DOCUMENTATION]
ORG_NAME = "Nested Org"

[[CURRENCIES]]
code = "USD"
issuer = "${issuer}"
display_name = "${hostileClaim}"
custom_claim = "  preserve spaces  "

[[CURRENCIES]]
code = "USD"
issuer = "G${'B'.repeat(55)}"
display_name = "Wrong issuer"
`;
		const service = new AssetMetadataService({
			cacheRoot: root,
			networkPassphrase: 'test-network',
			resolveIssuerHomeDomain: async () => 'issuer.example',
			requestImpl: async () => ok(claimedToml)
		});
		const result = await service.ensureAssetMetadata({
			id: 'USD:G...A',
			code: 'USD',
			issuer
		});
		expect(result.status).toBe('ready');
		expect(result.fields).toEqual({
			code: 'USD',
			issuer,
			display_name: hostileClaim,
			custom_claim: '  preserve spaces  '
		});
		expect(typeof result.fields?.display_name).toBe('string');
		expect(result.fields?.display_name).toBe(hostileClaim);
		expect(result.organization).toEqual({
			name: 'Root Org',
			'documentation.name': 'Nested Org'
		});
	});

	test('preserves last successful TOML when refresh fails', async () => {
		root = await mkdtemp(join(tmpdir(), 'asset-metadata-'));
		let now = Date.now();
		let fail = false;
		const service = new AssetMetadataService({
			cacheRoot: root,
			networkPassphrase: 'test-network',
			now: () => now,
			resolveIssuerHomeDomain: async () => 'issuer.example',
			requestImpl: async () => {
				if (fail) throw new Error('upstream failure');
				return ok(toml);
			}
		});
		const initial = await service.ensureIssuerMetadata(issuer);
		expect(initial?.currencies[0]?.name).toBe('Dollar One');
		now += 25 * 60 * 60 * 1000;
		fail = true;
		const refreshed = await service.ensureIssuerMetadata(issuer);
		expect(refreshed?.currencies[0]?.name).toBe('Dollar One');
		expect(refreshed?.error).toBe('Issuer metadata refresh failed');
	});

	test.each([
		'http://127.0.0.1/stellar.toml',
		'https://127.0.0.1/stellar.toml',
		'https://[::ffff:7f00:1]/stellar.toml',
		'https://[2001:db8::1]/stellar.toml'
	])('rejects unsafe metadata URL %s', async (url) => {
		await expect(validatePublicHttpsUrl(url)).rejects.toThrow();
	});
	test('reports issuer TOML 404 instead of claiming the asset is unlisted', async () => {
		root = await mkdtemp(join(tmpdir(), 'asset-metadata-'));
		const service = new AssetMetadataService({
			cacheRoot: root,
			networkPassphrase: 'test-network',
			resolveIssuerHomeDomain: async () => 'issuer.example',
			requestImpl: async () => ({
				status: 404,
				headers: {},
				body: Buffer.alloc(0)
			})
		});
		const result = await service.ensureAssetMetadata({
			id: 'USDC:issuer',
			code: 'USDC',
			issuer
		});
		expect(result.status).toBe('unavailable');
		expect(result.error).toBe('Issuer TOML returned HTTP 404');
		expect(result.error).not.toContain('No exact matching currency');
	});
	test('reaps an expired issuer lock and refreshes metadata', async () => {
		root = await mkdtemp(join(tmpdir(), 'asset-metadata-'));
		const homeDomain = 'issuer.example';
		const key = createHash('sha256')
			.update(`test-network\n${homeDomain}`)
			.digest('hex');
		const lockPath = join(root, 'issuers', `${key}.json.lock`);
		await mkdir(join(root, 'issuers'), { recursive: true });
		await writeFile(lockPath, 'stale');
		const staleAt = new Date(Date.now() - 120_000);
		await utimes(lockPath, staleAt, staleAt);
		const freshAt = new Date();
		await utimes(lockPath, freshAt, freshAt);
		expect(await removeExpiredLock(lockPath, Date.now(), 90_000)).toBe(false);
		await utimes(lockPath, staleAt, staleAt);
		let requests = 0;
		const service = new AssetMetadataService({
			cacheRoot: root,
			networkPassphrase: 'test-network',
			resolveIssuerHomeDomain: async () => homeDomain,
			requestImpl: async () => {
				requests++;
				return ok(toml);
			}
		});
		const result = await service.ensureIssuerMetadata(issuer);
		expect(result?.currencies[0]?.name).toBe('Dollar One');
		expect(requests).toBe(1);
		await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
	});
	test('serves stale issuer TOML while refreshing in the background', async () => {
		root = await mkdtemp(join(tmpdir(), 'asset-metadata-'));
		let now = Date.now();
		let requests = 0;
		const service = new AssetMetadataService({
			cacheRoot: root,
			networkPassphrase: 'test-network',
			now: () => now,
			resolveIssuerHomeDomain: async () => 'issuer.example',
			requestImpl: async () => {
				requests++;
				return ok(toml);
			}
		});
		const initial = await service.ensureIssuerMetadata(issuer);
		expect(initial?.currencies[0]?.name).toBe('Dollar One');
		now += 25 * 60 * 60 * 1000;
		const cached = await service.getIssuerMetadata('issuer.example');
		expect(cached?.currencies[0]?.name).toBe('Dollar One');
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(requests).toBe(2);
	});
});
