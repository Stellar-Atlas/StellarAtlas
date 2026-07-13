import express from 'express';
import {
	fetchExplorerAccount,
	fetchExplorerAssets,
	fetchExplorerLedger,
	fetchExplorerSearch,
	isAccountAddress,
	isContractAddress,
	isLedgerSequence,
	isTransactionHash,
	type ExplorerSearchType
} from './BlockchainExplorerClient.js';
import {
	fetchRecentTransactions,
	fetchTransactionByHash
} from './HorizonLedgerClient.js';
import { fetchExplorerTransactionOperations } from './ExplorerTransactionOperationClient.js';
import { createExplorerLocalOperationHandler } from './ExplorerLocalOperationHandler.js';
import { FullHistoryHash } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import type { GetExplorerLocalReadModel } from '../../use-cases/get-explorer-local-read-model/GetExplorerLocalReadModel.js';
import type { GetExplorerLocalTransactions } from '../../use-cases/get-explorer-local-transactions/GetExplorerLocalTransactions.js';

export interface BlockchainExplorerRouterConfig {
	readonly getExplorerLocalReadModel: Pick<
		GetExplorerLocalReadModel,
		'execute'
	>;
	readonly getExplorerLocalTransactions: Pick<
		GetExplorerLocalTransactions,
		'execute' | 'findByHash' | 'findLedger' | 'findOperations'
	>;
	readonly horizonUrl: string;
	readonly rpcUrl?: string;
}

const explorerCacheMaxAgeSeconds = 20;
const maxRecentTransactionLimit = 50;

export const blockchainExplorerRouter = (
	config: BlockchainExplorerRouterConfig
): express.Router => {
	const router = express.Router();

	router.get('/local-read-model', async (_req, res) => {
		setCacheHeader(res);
		try {
			return res
				.status(200)
				.json(await config.getExplorerLocalReadModel.execute());
		} catch {
			return res
				.status(502)
				.json({ error: 'Explorer local read model unavailable' });
		}
	});

	router.get('/local-transactions', async (req, res) => {
		const limit = readRecentTransactionLimit(req.query.limit);
		if (limit === null)
			return res.status(400).json({ error: 'Invalid local transaction limit' });

		setCacheHeader(res);
		try {
			return res
				.status(200)
				.json(await config.getExplorerLocalTransactions.execute(limit));
		} catch {
			return res
				.status(502)
				.json({ error: 'Explorer local transactions unavailable' });
		}
	});

	router.get(
		'/local-operations',
		createExplorerLocalOperationHandler(config.getExplorerLocalTransactions)
	);

	router.get('/search', async (req, res) => {
		const query = readQueryString(req.query.query);
		const type = readSearchType(req.query.type);
		if (query === null) return res.status(400).json({ error: 'Missing query' });
		if (type === null) return res.status(400).json({ error: 'Invalid type' });

		setCacheHeader(res);
		try {
			if (
				(type === 'transaction' || type === 'auto') &&
				isTransactionHash(query)
			) {
				const local = await config.getExplorerLocalTransactions.findByHash(
					query.toLowerCase()
				);
				if (local !== null) {
					return res.status(200).json({
						query,
						result: local,
						resultType: 'transaction',
						source: 'postgres_canonical'
					});
				}
			}
			if ((type === 'ledger' || type === 'auto') && isLedgerSequence(query)) {
				const local =
					await config.getExplorerLocalTransactions.findLedger(query);
				if (local !== null) {
					return res.status(200).json({
						query,
						result: local,
						resultType: 'ledger',
						source: 'postgres_canonical'
					});
				}
			}
			return res
				.status(200)
				.json(
					await fetchExplorerSearch(
						config.horizonUrl,
						config.rpcUrl,
						query,
						type
					)
				);
		} catch {
			return res.status(502).json({ error: 'Explorer search unavailable' });
		}
	});

	router.get('/transactions', async (req, res) => {
		const limit = readRecentTransactionLimit(req.query.limit);
		if (limit === null)
			return res.status(400).json({ error: 'Invalid transaction limit' });

		setCacheHeader(res);
		try {
			const local = await config.getExplorerLocalTransactions.execute(limit);
			return res
				.status(200)
				.json(
					local.records.length > 0
						? local
						: await fetchRecentTransactions(config.horizonUrl, limit)
				);
		} catch {
			return res.status(502).json({ error: 'Transaction feed unavailable' });
		}
	});

	router.get(
		'/transactions/:hash',
		createExplorerTransactionLookupHandler(config)
	);

	router.get('/transactions/:hash/operations', async (req, res) => {
		const hash = req.params.hash.trim().toLowerCase();
		if (!isTransactionHash(hash))
			return res.status(400).json({ error: 'Invalid transaction hash' });

		setCacheHeader(res);
		try {
			const localTransaction =
				await config.getExplorerLocalTransactions.findByHash(hash);
			if (localTransaction !== null) {
				return res.status(200).json(
					await config.getExplorerLocalTransactions.findOperations({
						limit: 100,
						transactionHash: FullHistoryHash.fromHex(hash)
					})
				);
			}
			const operations = await fetchExplorerTransactionOperations(
				config.horizonUrl,
				hash
			);
			if (!operations)
				return res.status(404).json({ error: 'Transaction not found' });
			return res.status(200).json(operations);
		} catch {
			return res
				.status(502)
				.json({ error: 'Transaction operations unavailable' });
		}
	});

	router.get('/ledgers/:sequence', async (req, res) => {
		const sequence = req.params.sequence.trim();
		if (!isLedgerSequence(sequence))
			return res.status(400).json({ error: 'Invalid ledger sequence' });

		setCacheHeader(res);
		try {
			const ledger =
				(await config.getExplorerLocalTransactions.findLedger(sequence)) ??
				(await fetchExplorerLedger(config.horizonUrl, sequence));
			if (!ledger) return res.status(404).json({ error: 'Ledger not found' });
			return res.status(200).json(ledger);
		} catch {
			return res.status(502).json({ error: 'Ledger lookup unavailable' });
		}
	});

	router.get('/accounts/:accountId', async (req, res) => {
		const accountId = req.params.accountId.trim();
		if (!isAccountAddress(accountId))
			return res.status(400).json({ error: 'Invalid account address' });

		setCacheHeader(res);
		try {
			const account = await fetchExplorerAccount(config.horizonUrl, accountId);
			if (!account) return res.status(404).json({ error: 'Account not found' });
			return res.status(200).json(account);
		} catch {
			return res.status(502).json({ error: 'Account lookup unavailable' });
		}
	});

	router.get('/assets', async (req, res) => {
		const assetCode = readOptionalString(req.query.assetCode);
		const assetIssuer = readOptionalString(req.query.assetIssuer);
		if (assetIssuer && !isAccountAddress(assetIssuer)) {
			return res.status(400).json({ error: 'Invalid asset issuer' });
		}

		setCacheHeader(res);
		try {
			return res
				.status(200)
				.json(
					await fetchExplorerAssets(config.horizonUrl, assetCode, assetIssuer)
				);
		} catch {
			return res.status(502).json({ error: 'Asset search unavailable' });
		}
	});

	router.get(
		'/operations',
		createExplorerLocalOperationHandler(config.getExplorerLocalTransactions)
	);

	router.get('/contracts/:contractId', async (req, res) => {
		const contractId = req.params.contractId.trim();
		if (!isContractAddress(contractId))
			return res.status(400).json({ error: 'Invalid contract id' });

		setCacheHeader(res);
		return res.status(200).json({
			contractId,
			message: config.rpcUrl
				? 'Local Stellar RPC is configured, but contract probing and indexing are not wired yet.'
				: 'Local Stellar RPC is planned and not configured on this host yet.',
			probe: 'not_run',
			readiness: config.rpcUrl ? 'configured_not_probed' : 'planned',
			source: 'rpc',
			status: config.rpcUrl ? 'configured_not_probed' : 'not_configured'
		});
	});

	return router;
};

export function createExplorerTransactionLookupHandler(
	config: Pick<
		BlockchainExplorerRouterConfig,
		'getExplorerLocalTransactions' | 'horizonUrl'
	>
): express.RequestHandler {
	return async (req, res) => {
		const hash = req.params.hash.trim().toLowerCase();
		if (!isTransactionHash(hash)) {
			return res.status(400).json({ error: 'Invalid transaction hash' });
		}

		setCacheHeader(res);
		try {
			const local = await config.getExplorerLocalTransactions.findByHash(hash);
			const transaction =
				local ?? (await fetchTransactionByHash(config.horizonUrl, hash));
			if (transaction === null) {
				return res.status(404).json({ error: 'Transaction not found' });
			}
			return res.status(200).json(transaction);
		} catch {
			return res.status(502).json({ error: 'Transaction lookup unavailable' });
		}
	};
}

function readQueryString(value: unknown): string | null {
	const query = readOptionalString(value);
	return query && query.length > 0 ? query : null;
}

function readRecentTransactionLimit(value: unknown): number | null {
	if (value === undefined) return 20;
	if (typeof value !== 'string') return null;

	const limit = Number(value);
	if (
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > maxRecentTransactionLimit
	) {
		return null;
	}

	return limit;
}

function readOptionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0
		? value.trim()
		: undefined;
}

function readSearchType(value: unknown): ExplorerSearchType | null {
	if (value === undefined) return 'auto';
	if (typeof value !== 'string') return null;
	if (
		value === 'account' ||
		value === 'asset' ||
		value === 'auto' ||
		value === 'contract' ||
		value === 'ledger' ||
		value === 'transaction'
	) {
		return value;
	}
	return null;
}

function setCacheHeader(res: express.Response): void {
	res.setHeader(
		'Cache-Control',
		`public, max-age=${explorerCacheMaxAgeSeconds}`
	);
}
