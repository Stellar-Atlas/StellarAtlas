import express from 'express';
import {
	fetchLatestLedger,
	fetchLedgerTransactions,
	fetchTransactionByHash,
	type LatestLedgerDTO,
	type LedgerTransactionsDTO,
	type TransactionLookupDTO
} from './HorizonLedgerClient.js';

type FetchLatestLedger = (horizonUrl: string) => Promise<LatestLedgerDTO>;
type FetchLedgerTransactions = (
	horizonUrl: string,
	slotIndex: string
) => Promise<LedgerTransactionsDTO>;
type FetchTransactionByHash = (
	horizonUrl: string,
	hash: string
) => Promise<TransactionLookupDTO | null>;

export interface HorizonExplorerRouterConfig {
	readonly fetchLatestLedger?: FetchLatestLedger;
	readonly fetchLedgerTransactions?: FetchLedgerTransactions;
	readonly fetchTransaction?: FetchTransactionByHash;
	readonly horizonUrl: string;
}

const ledgerSequencePattern = /^\d+$/;
const transactionHashPattern = /^[a-f0-9]{64}$/i;

export const horizonExplorerRouter = (
	config: HorizonExplorerRouterConfig
): express.Router => {
	const router = express.Router();
	const fetchLedger = config.fetchLatestLedger ?? fetchLatestLedger;
	const fetchTransactions =
		config.fetchLedgerTransactions ?? fetchLedgerTransactions;
	const fetchTransaction = config.fetchTransaction ?? fetchTransactionByHash;

	router.get(
		'/ledger/latest',
		async (_req: express.Request, res: express.Response) => {
			res.setHeader('Cache-Control', 'public, max-age=2');

			try {
				const payload = await fetchLedger(config.horizonUrl);
				return res.status(200).json(payload);
			} catch {
				return res.status(502).json({ error: 'Latest ledger unavailable' });
			}
		}
	);

	router.get(
		'/scp/slots/:slotIndex/transactions',
		async (req: express.Request, res: express.Response) => {
			const slotIndex = req.params.slotIndex;
			if (!ledgerSequencePattern.test(slotIndex))
				return res.status(400).json({ error: 'Invalid ledger slot' });

			res.setHeader('Cache-Control', 'public, max-age=30');

			try {
				const payload = await fetchTransactions(config.horizonUrl, slotIndex);
				return res.status(200).json(payload);
			} catch {
				return res
					.status(502)
					.json({ error: 'Ledger transactions unavailable' });
			}
		}
	);

	router.get(
		'/transactions/:hash',
		async (req: express.Request, res: express.Response) => {
			const hash = req.params.hash.trim();
			if (!transactionHashPattern.test(hash))
				return res.status(400).json({ error: 'Invalid transaction hash' });

			res.setHeader('Cache-Control', 'public, max-age=30');

			try {
				const transaction = await fetchTransaction(
					config.horizonUrl,
					hash.toLowerCase()
				);
				if (!transaction) {
					return res
						.status(404)
						.json({ error: 'Transaction not found in configured Horizon' });
				}
				return res.status(200).json(transaction);
			} catch {
				return res
					.status(502)
					.json({ error: 'Transaction lookup unavailable' });
			}
		}
	);

	return router;
};
