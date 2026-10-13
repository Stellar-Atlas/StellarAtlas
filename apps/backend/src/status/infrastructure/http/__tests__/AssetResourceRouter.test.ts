import express from 'express';
import request from 'supertest';
import { Networks } from '@stellar/stellar-sdk';
import type { HubbleWarehouse } from '../HubbleWarehouseContracts.js';
import { summarizeHubbleLedgerCoverage } from '../HubbleLedgerCoverage.js';
import { AssetMetadataService } from '../asset-metadata/AssetMetadataService.js';
import { AssetCatalogue } from '../asset-catalogue/AssetCatalogue.js';
import { AssetCatalogueSource } from '../asset-catalogue/AssetCatalogueSource.js';
import { classicAsset, type AssetIdentity } from '../asset-catalogue/AssetIdentity.js';
import { assetResourceRouter } from '../asset-catalogue/AssetResourceRouter.js';

describe('AssetResourceRouter', () => {
	const issuer = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
	const asset = classicAsset('USDC', issuer, Networks.PUBLIC);
	const observation = {
		...asset,
		firstObservedLedger: 10,
		lastObservedLedger: 20,
		firstObservedAt: '2025-01-01T00:00:00.000Z',
		lastObservedAt: '2025-01-02T00:00:00.000Z'
	};

	function buildApp() {
		const search = jest.fn().mockResolvedValue({
			data: [observation],
			nextCursor: null,
			coverage: { source: 'published-parsed-history', catalogueReady: true }
		});
		const resolve = jest.fn(
			async (reference: string): Promise<AssetIdentity | string> => {
				if (reference === asset.id || reference === asset.contractId) return asset;
				return reference;
			}
		);
		const catalogue = { search, resolve } as unknown as AssetCatalogue;
		const metadata = {
			getCachedLogoDirectory: jest.fn().mockReturnValue('/tmp/asset-router-test'),
			getAssetMetadata: jest.fn().mockResolvedValue({
				status: 'ready',
				name: 'USD Coin',
				logoUrl: null,
				logoStatus: 'unavailable'
			}),
			getIssuerMetadata: jest.fn().mockResolvedValue(null),
			ensureIssuerMetadata: jest.fn().mockResolvedValue(undefined)
		} as unknown as AssetMetadataService;
		const source = {
			issuerHomeDomain: jest.fn().mockResolvedValue('circle.com')
		} as unknown as AssetCatalogueSource;
		const assetHolders = jest.fn().mockResolvedValue({ holders: [] });
		const catalog = jest.fn().mockResolvedValue({
			coverage: summarizeHubbleLedgerCoverage([
				{ start_ledger: 2, end_ledger: 100 }
			]),
			generatedAt: '2025-01-02T00:00:00.000Z'
		});
		const query = jest.fn().mockResolvedValue({
			columns: [],
			dataset: 'history_trades',
			elapsedMilliseconds: 1,
			limit: 25,
			nextOffset: null,
			offset: 0,
			rows: []
		});
		const warehouse = { assetHolders, catalog, query } as unknown as HubbleWarehouse;
		const app = express();
		app.use(
			'/v1',
			assetResourceRouter({
				networkPassphrase: Networks.PUBLIC,
				warehouse,
				catalogue,
				metadata,
				source
			})
		);
		return { app, catalogue, assetHolders, query };
	}

	it('lists assets using bounded catalogue filters', async () => {
		const { app, catalogue } = buildApp();
		await request(app)
			.get('/v1/assets?q=USDC&limit=1')
			.expect(200)
			.expect(({ body }) => {
				expect(body.data[0]).toMatchObject({
					id: asset.id,
					firstObservedLedger: 10,
					lastObservedLedger: 20,
					name: 'USD Coin'
				});
			});
		expect(catalogue.search).toHaveBeenCalledWith(
			expect.objectContaining({ q: 'USDC', limit: 1 })
		);
	});

	it('resolves classic and SAC references to the same asset detail', async () => {
		const { app, catalogue } = buildApp();
		const classic = await request(app)
			.get('/v1/assets/' + encodeURIComponent(asset.id))
			.expect(200);
		const sac = await request(app)
			.get('/v1/assets/' + asset.contractId)
			.expect(200);
		expect(classic.body.asset.id).toBe(asset.id);
		expect(sac.body.asset.id).toBe(asset.id);
		expect(catalogue.resolve).toHaveBeenNthCalledWith(1, asset.id);
		expect(catalogue.resolve).toHaveBeenNthCalledWith(2, asset.contractId);
	});

	it('filters issuer asset listings by the exact G-address', async () => {
		const { app, catalogue } = buildApp();
		await request(app)
			.get('/v1/issuers/' + issuer + '/assets?limit=2')
			.expect(200)
			.expect(({ body }) => expect(body.data[0].id).toBe(asset.id));
		expect(catalogue.search).toHaveBeenCalledWith(
			expect.objectContaining({ issuer, limit: 2 })
		);
	});

	it('normalizes a SAC holder route before warehouse lookup', async () => {
		const { app, assetHolders, catalogue } = buildApp();
		await request(app)
			.get('/v1/assets/' + asset.contractId + '/holders?limit=7')
			.expect(200);
		expect(catalogue.resolve).toHaveBeenCalledWith(asset.contractId);
		expect(assetHolders).toHaveBeenCalledWith({
			asset: { type: 'issued', code: 'USDC', issuer },
			limit: 7,
			asOfLedger: undefined,
			order: 'asc',
			sort: 'account'
		});
	});

	it('routes typed trades through the explorer view before semantic fallback', async () => {
		const { app, query } = buildApp();
		const response = await request(app)
			.get('/v1/trades?view=typed&min_ledger=10&max_ledger=10')
			.expect(200);
		expect(response.body.entity).toBe('trades');
		expect(query).toHaveBeenCalledWith(
			expect.objectContaining({ dataset: 'history_trades' })
		);
	});
});
