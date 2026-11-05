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
import { GetExplorerRecentTransactions } from '@network-scan/use-cases/get-explorer-recent-transactions/GetExplorerRecentTransactions.js';
import { fetchRecentTransactions } from '@network-scan/infrastructure/http/HorizonLedgerClient.js';
import { hubbleWarehouseFromEnvironment } from '../../../status/infrastructure/http/HubbleWarehouseClient.js';
import { fetchParsedRecentTransactions } from '@network-scan/use-cases/get-explorer-recent-transactions/ParsedRecentTransactions.js';
import { createAccountFederation } from '../../../status/infrastructure/http/federation/AccountFederationRouter.js';

export async function mountExplorerRoutes(
	api: express.Express,
	kernel: Kernel,
	config: Config
): Promise<() => Promise<boolean>> {
	const getExplorerLocalTransactions = kernel.container.get(
		GetExplorerLocalTransactions
	);
	const warehouse = hubbleWarehouseFromEnvironment();
	const getExplorerRecentTransactions = new GetExplorerRecentTransactions({
		fetchParsedTransactions:
			process.env.EXPLORER_PARSED_HISTORY_FEED_ENABLED === 'true'
				? (limit) => fetchParsedRecentTransactions(warehouse, limit)
				: undefined,
		fetchLiveTransactions: (limit) =>
			fetchRecentTransactions(config.horizonUrl.value, limit),
		freshnessWindowMs: config.explorerTransactionFreshnessWindowMs,
		getLocalTransactions: getExplorerLocalTransactions,
		now: () => new Date()
	});
	const getExplorerLocalAccountChanges = kernel.container.get(
		GetExplorerLocalAccountChanges
	);
	const federation = await createAccountFederation(
		process.env.FEDERATION_SCHEDULE_DIRECTORY,
		config.networkConfig.networkPassphrase,
		(query) => getExplorerLocalAccountChanges.execute(query)
	);
	api.use('/v1/explorer', federation.router);
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
			getExplorerRecentTransactions,
			horizonUrl: config.horizonUrl.value,
			networkPassphrase: config.networkConfig.networkPassphrase,
			rpcUrl: config.rpcUrl?.value
		})
	);
	return federation.drain;
}
