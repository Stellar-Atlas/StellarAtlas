import { jest } from '@jest/globals';
import { WalletAssetMetadataCache } from '../explorer-wallet-metadata';

const issuer = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const contractId = 'CA526Y2NQWGWVVQ7RFFPGAZMU66PSYJ3UC2MTVAV4ZU7OM5BOPHDXUSG';
const raster = '/v1/asset-logos/' + 'a'.repeat(64) + '.png';
const ids = Array.from({ length: 25 }, (_, index) => 'AS' + index + ':' + issuer);

it('shares in-flight work, uses at most two cache-only batches, and matches exact returned identity', async () => {
	const lookup = jest.fn(async (path: string, _signal: AbortSignal) => {
		const query = new URL(path, 'https://fixture.invalid').searchParams;
		expect(query.get('cacheOnly')).toBe('true');
		const group = JSON.parse(query.get('assets')!) as string[];
		expect(group.length).toBeLessThanOrEqual(16);
		return { assets: group.map(id => ({
			id, kind: 'classic', code: id === ids[1] ? 'OTHER' : id.split(':')[0], issuer, contractId,
			status: id === ids[2] ? 'unavailable' : 'ready',
			cacheStatus: id === ids[2] ? 'miss' : 'hit', logoStatus: 'ready',
			logoUrl: id === ids[3] ? 'https://third-party.invalid/logo.png' : raster,
			issuerCollectible: { kind: 'sep39-collectible-link', source: 'issuer-toml', scarcity: 'unverified' }
		})) };
	});
	const cache = new WalletAssetMetadataCache(lookup);
	const [page, overlap] = await Promise.all([cache.load(ids), cache.load(ids.slice(0, 10))]);
	expect(lookup).toHaveBeenCalledTimes(2);
	expect(page[ids[0]!]?.logoUrl).toBe(raster);
	expect(overlap[ids[0]!]).toEqual(page[ids[0]!]);
	expect(page[ids[1]!]).toBeUndefined();
	expect(page[ids[2]!]).toBeUndefined();
	expect(page[ids[3]!]?.logoUrl).toBeNull();
	expect(page[ids[0]!]?.issuerCollectible).toEqual({ kind: 'sep39-collectible-link', source: 'issuer-toml', scarcity: 'unverified' });
	await cache.load([ids[2]!, 'native', 'USD']);
	expect(lookup).toHaveBeenCalledTimes(2);
});
