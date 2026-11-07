import express from 'express';
import type Kernel from '../Kernel.js';
import type { Config } from '../../config/Config.js';
import type { FullHistoryCanonicalRepository } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalRepository.js';
import { TYPES as HISTORY_TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import { composeExplorerAccountProtocolPositionHandler } from '@network-scan/infrastructure/http/ExplorerAccountProtocolPositionComposition.js';
import { SorobanEvidenceStore } from '../../../status/infrastructure/soroban-positions/SorobanEvidenceStore.js';
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
	kernel: Pick<Kernel, 'container'>,
	config: Config,
	accountProtocolPosition?: ReturnType<
		typeof composeExplorerAccountProtocolPositionHandler
	>,
	_backgroundTasksEnabled = true
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
		// This explicit opt-in owns demand-driven requests independently of background work.
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
			accountProvider: config.explorerAccountProvider,
			accountProtocolPosition,
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

export async function prepareExplorerAccountProtocolPositionHandler(
	kernel: Pick<Kernel, 'container'>,
	config: Config
): Promise<
	ReturnType<typeof composeExplorerAccountProtocolPositionHandler> | undefined
> {
	const settings = config.explorerAccountProtocolPositions;
	if (!settings) return undefined;
	const store = await SorobanEvidenceStore.open(
		settings.root,
		settings.limits
	).catch(() => {
		throw new Error('Account protocol position private store is unavailable');
	});
	return composeExplorerAccountProtocolPositionHandler({
		references: settings.references,
		recentWithinMs: settings.recentWithinMs,
		store,
		canonicalLedger: kernel.container.get<FullHistoryCanonicalRepository>(
			HISTORY_TYPES.FullHistoryCanonicalRepository
		)
	});
}
