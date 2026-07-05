import express from 'express';
import {
	fetchExplorerAccount,
	fetchExplorerAssets,
	fetchExplorerLedger,
	fetchExplorerOperations,
	fetchExplorerSearch,
	isAccountAddress,
	isContractAddress,
	isLedgerSequence,
	isTransactionHash,
	type ExplorerOperationFilters,
	type ExplorerSearchType
} from './BlockchainExplorerClient.js';
import {
	fetchRecentTransactions,
	fetchTransactionByHash
} from './HorizonLedgerClient.js';

export interface BlockchainExplorerRouterConfig {
	readonly horizonUrl: string;
	readonly rpcUrl?: string;
}

const explorerCacheMaxAgeSeconds = 20;
const maxRecentTransactionLimit = 50;
const operationTypePattern = /^[a-z][a-z0-9_]{0,63}$/;

export const blockchainExplorerRouter = (
	config: BlockchainExplorerRouterConfig
): express.Router => {
	const router = express.Router();

	router.get('/search', async (req, res) => {
		const query = readQueryString(req.query.query);
		const type = readSearchType(req.query.type);
		if (query === null) return res.status(400).json({ error: 'Missing query' });
		if (type === null) return res.status(400).json({ error: 'Invalid type' });

		setCacheHeader(res);
		try {
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
			return res
				.status(200)
				.json(await fetchRecentTransactions(config.horizonUrl, limit));
		} catch {
			return res.status(502).json({ error: 'Transaction feed unavailable' });
		}
	});

	router.get('/transactions/:hash', async (req, res) => {
		const hash = req.params.hash.trim().toLowerCase();
		if (!isTransactionHash(hash))
			return res.status(400).json({ error: 'Invalid transaction hash' });

		setCacheHeader(res);
		try {
			const transaction = await fetchTransactionByHash(config.horizonUrl, hash);
			if (!transaction)
				return res.status(404).json({ error: 'Transaction not found' });
			return res.status(200).json(transaction);
		} catch {
			return res.status(502).json({ error: 'Transaction lookup unavailable' });
		}
	});

	router.get('/ledgers/:sequence', async (req, res) => {
		const sequence = req.params.sequence.trim();
		if (!isLedgerSequence(sequence))
			return res.status(400).json({ error: 'Invalid ledger sequence' });

		setCacheHeader(res);
		try {
			const ledger = await fetchExplorerLedger(config.horizonUrl, sequence);
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

	router.get('/operations', async (req, res) => {
		const filters = readOperationFilters(req);
		if (filters === null)
			return res.status(400).json({ error: 'Invalid operation filters' });

		setCacheHeader(res);
		try {
			return res
				.status(200)
				.json(await fetchExplorerOperations(config.horizonUrl, filters));
		} catch {
			return res.status(502).json({ error: 'Operation search unavailable' });
		}
	});

	router.get('/contracts/:contractId', async (req, res) => {
		const contractId = req.params.contractId.trim();
		if (!isContractAddress(contractId))
			return res.status(400).json({ error: 'Invalid contract id' });

		setCacheHeader(res);
		return res.status(200).json({
			contractId,
			message: config.rpcUrl
				? 'Contract indexing is waiting for the local RPC read path.'
				: 'Stellar RPC is not configured on this host yet.',
			source: 'rpc',
			status: config.rpcUrl ? 'unavailable' : 'unconfigured'
		});
	});

	return router;
};

function readOperationFilters(
	req: express.Request
): ExplorerOperationFilters | null {
	const ledger = readOptionalString(req.query.ledger);
	const accountId = readOptionalString(req.query.accountId);
	const operationType = readOptionalString(req.query.operationType);
	const from = readOptionalString(req.query.from);
	const to = readOptionalString(req.query.to);

	if (ledger && !isLedgerSequence(ledger)) return null;
	if (accountId && !isAccountAddress(accountId)) return null;
	if (operationType && !operationTypePattern.test(operationType)) return null;
	if (from && Number.isNaN(Date.parse(from))) return null;
	if (to && Number.isNaN(Date.parse(to))) return null;

	return {
		...(accountId ? { accountId } : {}),
		...(from ? { from } : {}),
		...(ledger ? { ledger } : {}),
		...(operationType ? { operationType } : {}),
		...(to ? { to } : {})
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
