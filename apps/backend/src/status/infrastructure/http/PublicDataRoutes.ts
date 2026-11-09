import type { Express } from 'express';
import type { EntityManager } from 'typeorm';
import { join } from 'node:path';
import { assetResourceRouter } from './asset-catalogue/AssetResourceRouter.js';
import { AssetCatalogue } from './asset-catalogue/AssetCatalogue.js';
import { AssetCatalogueSource } from './asset-catalogue/AssetCatalogueSource.js';
import { IssuerDomainCache } from './issuer-domains/IssuerDomainCache.js';
import { IssuerDomainLookup } from './issuer-domains/IssuerDomainLookup.js';
import { issuerDomainRouter } from './issuer-domains/IssuerDomainRouter.js';
import { hubbleWarehouseRouter } from './HubbleWarehouseRouter.js';
import { hubbleWarehouseGraphqlHandler } from './HubbleWarehouseGraphql.js';
import { publicGoodsRouter, type PublicGoodsRouterConfig } from './PublicGoodsRouter.js';
import { createPublicGoodsReadinessReader } from './PublicGoodsReadinessReader.js';
import { sorobanDomainRouter } from './soroban-domains/SorobanDomainRouter.js';
import type { DirectoryReader } from '../directory/DirectoryReader.js';
import { directoryRoutePrefix, directoryRouter } from './DirectoryRouter.js';
import { contractCatalogueRouter } from './contract-provenance/ContractCatalogueRouter.js';
import { ContractCatalogueStore } from './contract-provenance/ContractCatalogueStore.js';
import { observeAtlasRest } from './AtlasEventAnalytics.js';

interface PublicDataRouteConfig {
	readonly warehouse: PublicGoodsRouterConfig['warehouse'];
	readonly getArchiveStatusSummary: PublicGoodsRouterConfig['getArchiveStatusSummary'];
	readonly manager: EntityManager;
	readonly networkPassphrase: string;
	readonly backgroundTasksEnabled?: boolean;
	readonly directory?: DirectoryReader;
}

export function mountPublicDataRoutes(app: Express, config: PublicDataRouteConfig): void {
	const contractCatalogue = process.env.STELLAR_ATLAS_CONTRACT_CATALOGUE_ENABLED === '1'
		? new ContractCatalogueStore(config.manager, config.networkPassphrase)
		: undefined;
	app.use('/v1', contractCatalogueRouter(config.networkPassphrase, contractCatalogue));
	if (config.directory)
		app.use(directoryRoutePrefix, directoryRouter(config.directory));
	app.get([
		'/v1/analytics/transactions/:transactionHash',
		'/v1/analytics/operations/:operationId',
		'/v1/analytics/ledgers/:sequence',
		'/v1/analytics/accounts/:account/balances',
		'/v1/analytics/assets/:asset/holders'
	], observeAtlasRest);
	app.use('/v1/analytics', hubbleWarehouseRouter({ warehouse: config.warehouse }));
	app.use('/v1', sorobanDomainRouter({
		rpcUrl: process.env.STELLAR_RPC_URL,
		networkPassphrase: config.networkPassphrase
	}));
	const cacheRoot = process.env.ASSET_METADATA_CACHE_ROOT ?? '/mnt/stellaratlas_assets';
	const source = new AssetCatalogueSource(config.networkPassphrase);
	const catalogue = new AssetCatalogue(source, join(cacheRoot, 'catalogue'), config.networkPassphrase);
	if (config.backgroundTasksEnabled !== false) catalogue.start();
	else void catalogue.load();
	app.use('/v1', issuerDomainRouter(
		config.networkPassphrase,
		new IssuerDomainLookup(new IssuerDomainCache(join(cacheRoot, 'metadata'), config.networkPassphrase), catalogue)
	));
	app.use('/v1', assetResourceRouter({
		warehouse: config.warehouse,
		networkPassphrase: config.networkPassphrase,
		cacheRoot,
		source,
		catalogue,
		observeContractVerification: contractCatalogue?.observe.bind(contractCatalogue)
	}));
	app.use('/v1/public-goods', publicGoodsRouter({
		warehouse: config.warehouse,
		getArchiveStatusSummary: config.getArchiveStatusSummary,
		readReadinessSnapshot: createPublicGoodsReadinessReader({
			warehouse: config.warehouse, manager: config.manager
		})
	}));
	app.all('/graphql', hubbleWarehouseGraphqlHandler(config.warehouse));
}
