import express from 'express';
import Kernel from '../Kernel.js';
import type { Config } from '../../config/Config.js';
import {
	blockchainExplorerRouter,
	createExplorerTransactionLookupHandler
} from '@network-scan/infrastructure/http/BlockchainExplorerRouter.js';
import { horizonExplorerRouter } from '@network-scan/infrastructure/http/HorizonExplorerRouter.js';
import { explorerLocalLedgerRouter } from '@network-scan/infrastructure/http/ExplorerLocalLedgerRouter.js';
import { explorerLocalAccountRouter } from '@network-scan/infrastructure/http/ExplorerLocalAccountRouter.js';
import { GetExplorerLocalAccountChanges } from '@network-scan/use-cases/get-explorer-local-account-changes/GetExplorerLocalAccountChanges.js';
import { GetExplorerLocalTrustlineChanges } from '@network-scan/use-cases/get-explorer-local-trustline-changes/GetExplorerLocalTrustlineChanges.js';
import { GetExplorerLocalLedgers } from '@network-scan/use-cases/get-explorer-local-ledgers/GetExplorerLocalLedgers.js';
import { GetExplorerLocalReadModel } from '@network-scan/use-cases/get-explorer-local-read-model/GetExplorerLocalReadModel.js';
import { GetExplorerLocalTransactions } from '@network-scan/use-cases/get-explorer-local-transactions/GetExplorerLocalTransactions.js';

export function mountExplorerRoutes(
	api: express.Express,
	kernel: Kernel,
	config: Config
): void {
	const getExplorerLocalTransactions = kernel.container.get(
		GetExplorerLocalTransactions
	);
	const getExplorerLocalAccountChanges = kernel.container.get(
		GetExplorerLocalAccountChanges
	);
	api.get(
		'/v1/transactions/:hash',
		createExplorerTransactionLookupHandler({
			getExplorerLocalTransactions,
			horizonUrl: config.horizonUrl.value
		})
	);
	api.use(
		'/v1/explorer/local-ledgers',
		explorerLocalLedgerRouter({
			getExplorerLocalLedgers: kernel.container.get(GetExplorerLocalLedgers)
		})
	);
	api.use(
		'/v1/explorer/local-accounts',
		explorerLocalAccountRouter({
			getExplorerLocalAccountChanges,
			getExplorerLocalTrustlineChanges: kernel.container.get(
				GetExplorerLocalTrustlineChanges
			)
		})
	);
	api.use(
		'/v1',
		horizonExplorerRouter({
			horizonUrl: config.horizonUrl.value
		})
	);

	api.use(
		'/v1/explorer',
		blockchainExplorerRouter({
			getExplorerLocalAccountChanges,
			getExplorerLocalReadModel: kernel.container.get(
				GetExplorerLocalReadModel
			),
			getExplorerLocalTransactions,
			horizonUrl: config.horizonUrl.value,
			rpcUrl: config.rpcUrl?.value
		})
	);
}
