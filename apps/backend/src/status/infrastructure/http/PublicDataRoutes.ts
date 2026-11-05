import type { Express } from 'express';
import type { EntityManager } from 'typeorm';
import { assetResourceRouter } from './asset-catalogue/AssetResourceRouter.js';
import { hubbleWarehouseRouter } from './HubbleWarehouseRouter.js';
import { hubbleWarehouseGraphqlHandler } from './HubbleWarehouseGraphql.js';
import { publicGoodsRouter, type PublicGoodsRouterConfig } from './PublicGoodsRouter.js';
import { createPublicGoodsReadinessReader } from './PublicGoodsReadinessReader.js';
import { sorobanDomainRouter } from './soroban-domains/SorobanDomainRouter.js';

interface PublicDataRouteConfig {
	readonly warehouse: PublicGoodsRouterConfig['warehouse'];
	readonly getArchiveStatusSummary: PublicGoodsRouterConfig['getArchiveStatusSummary'];
	readonly manager: EntityManager;
	readonly networkPassphrase: string;
}

export function mountPublicDataRoutes(app: Express, config: PublicDataRouteConfig): void {
	app.use('/v1/analytics', hubbleWarehouseRouter({ warehouse: config.warehouse }));
	app.use('/v1', sorobanDomainRouter({
		rpcUrl: process.env.STELLAR_RPC_URL,
		networkPassphrase: config.networkPassphrase
	}));
	app.use('/v1', assetResourceRouter({
		warehouse: config.warehouse,
		networkPassphrase: config.networkPassphrase
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
