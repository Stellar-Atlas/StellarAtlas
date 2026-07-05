import express, { Router } from 'express';
import type { Result } from 'neverthrow';
import { GetFullHistoryStatus } from '../../use-cases/get-full-history-status/GetFullHistoryStatus.js';

export interface FullHistoryRouterConfig {
	readonly getFullHistoryStatus: GetFullHistoryStatus;
}

const cacheMaxAgeSeconds = 10;
const defaultLimit = 25;
const maxLimit = 100;
const ledgerSequencePattern = /^\d+$/;

export const FullHistoryRouterWrapper = (
	config: FullHistoryRouterConfig
): Router => {
	const router = express.Router();

	router.get('/status/full-history', async (_req, res) => {
		return sendResult(
			res,
			await config.getFullHistoryStatus.executeFullHistory()
		);
	});

	router.get('/status/ingestion', async (_req, res) => {
		return sendResult(res, await config.getFullHistoryStatus.executeIngestion());
	});

	router.get('/indexing/jobs', async (req, res) => {
		const limit = parseLimit(req.query.limit);
		if (limit === null) return res.status(400).json({ error: 'Invalid limit' });
		return sendResult(
			res,
			await config.getFullHistoryStatus.executeJobs(limit)
		);
	});

	router.get('/indexing/ranges', async (req, res) => {
		const limit = parseLimit(req.query.limit);
		if (limit === null) return res.status(400).json({ error: 'Invalid limit' });
		return sendResult(
			res,
			await config.getFullHistoryStatus.executeRanges(limit)
		);
	});

	router.get('/ledgers/:sequence/ingestion-status', async (req, res) => {
		const sequence = req.params.sequence.trim();
		if (!ledgerSequencePattern.test(sequence)) {
			return res.status(400).json({ error: 'Invalid ledger sequence' });
		}

		return sendResult(
			res,
			await config.getFullHistoryStatus.executeLedger(sequence)
		);
	});

	return router;
};

function parseLimit(value: unknown): number | null {
	if (value === undefined) return defaultLimit;
	if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
	const limit = Number(value);
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) return null;
	return limit;
}

function sendResult<T>(
	res: express.Response,
	result: Result<T, Error>
): express.Response {
	res.setHeader('Cache-Control', `public, max-age=${cacheMaxAgeSeconds}`);
	if (result.isErr()) {
		return res.status(500).json({ error: 'Internal server error' });
	}
	return res.status(200).json(result.value);
}

export { FullHistoryRouterWrapper as fullHistoryRouter };
