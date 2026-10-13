import express from 'express';
import request from 'supertest';
import { Networks } from '@stellar/stellar-sdk';
import { AssetCatalogue } from '../AssetCatalogue.js';
import { classicAsset } from '../AssetIdentity.js';
import { registerAssetRelatedRoutes } from '../AssetRelatedRoutes.js';

test('asset metadata deduplicates canonical identities and similar assets excludes the reference', async () => {
	const issuer = 'GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE';
	const secondIssuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
	const asset = classicAsset('KALE', issuer, Networks.PUBLIC);
	const similar = classicAsset('KALE', secondIssuer, Networks.PUBLIC);
	const search = jest.fn().mockResolvedValue({
		data: [asset, similar],
		nextCursor: null,
		generatedAt: '2026-10-13T00:00:00.000Z'
	});
	const resolve = jest.fn(async (reference: string) => {
		if (reference === asset.id || reference === asset.contractId) return asset;
		if (reference === 'KALE') return 'KALE';
		return similar;
	});
	const catalogue = { resolve, search } as unknown as AssetCatalogue;
	const metadataLoader = jest.fn(async () => ({
		status: 'ready' as const,
		name: 'Kale',
		logoUrl: '/v1/asset-logos/abc.png',
		logoStatus: 'ready' as const,
		homeDomain: 'kale.io'
	}));
	const router = express.Router();
	registerAssetRelatedRoutes(router, catalogue, metadataLoader);
	const app = express();
	app.use('/v1', router);

	await request(app)
		.get('/v1/asset-metadata')
		.query({ assets: JSON.stringify([asset.id, asset.contractId, asset.id]) })
		.expect(200)
		.expect(({ body }) => {
			expect(body.assets).toHaveLength(1);
			expect(body.assets[0]).toMatchObject({
				id: asset.id,
				status: 'ready',
				homeDomain: 'kale.io',
				referenceIdentity: asset.id,
				source: 'https://github.com/kalepail/kale-sc'
			});
		});
	expect(resolve).toHaveBeenCalledTimes(2);
	expect(metadataLoader).toHaveBeenCalledTimes(1);

	await request(app)
		.get('/v1/assets/' + encodeURIComponent(asset.id) + '/similar?limit=1')
		.expect(200)
		.expect(({ body }) => {
			expect(body.asset.id).toBe(asset.id);
			expect(body.data).toHaveLength(1);
			expect(body.data[0].id).toBe(similar.id);
			expect(body.data[0].referenceIdentity).toBeNull();
			expect(body.semantics).toBe('same-symbol assets; not an assessment of legitimacy');
		});
	expect(search).toHaveBeenCalledWith({ symbol: 'KALE', limit: 1 });

	await request(app)
		.get('/v1/asset-metadata')
		.query({ assets: JSON.stringify(['KALE']) })
		.expect(400);
});
