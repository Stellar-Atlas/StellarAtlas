import express from 'express';
import Kernel from '../Kernel.js';
import type { Config } from '../../config/Config.js';
import { blockchainExplorerRouter } from '@network-scan/infrastructure/http/BlockchainExplorerRouter.js';
import { horizonExplorerRouter } from '@network-scan/infrastructure/http/HorizonExplorerRouter.js';
import { GetExplorerLocalReadModel } from '@network-scan/use-cases/get-explorer-local-read-model/GetExplorerLocalReadModel.js';
import { GetExplorerLocalTransactions } from '@network-scan/use-cases/get-explorer-local-transactions/GetExplorerLocalTransactions.js';

export function mountExplorerRoutes(
	api: express.Express,
	kernel: Kernel,
	config: Config
): void {
	api.use(
		'/v1',
		horizonExplorerRouter({
			horizonUrl: config.horizonUrl.value
		})
	);

	api.use(
		'/v1/explorer',
		blockchainExplorerRouter({
			getExplorerLocalReadModel: kernel.container.get(
				GetExplorerLocalReadModel
			),
			getExplorerLocalTransactions: kernel.container.get(
				GetExplorerLocalTransactions
			),
			horizonUrl: config.horizonUrl.value,
			rpcUrl: config.rpcUrl?.value
		})
	);
}
