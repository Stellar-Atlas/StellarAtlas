import express from 'express';
import {
	fullHistoryLedgerSequence,
	type FullHistoryLedgerSequence
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import {
	validateFullHistoryLedgerRangeQuery,
	type FullHistoryLedgerRangeQuery
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalLedger.js';
import type {
	ExplorerLocalLedgerLookupDTO,
	ExplorerLocalLedgerRangeDTO,
	GetExplorerLocalLedgers
} from '../../use-cases/get-explorer-local-ledgers/GetExplorerLocalLedgers.js';

export interface ExplorerLocalLedgerRouterConfig {
	readonly getExplorerLocalLedgers: Pick<
		GetExplorerLocalLedgers,
		'findBySequence' | 'findRange'
	>;
}

const cacheMaxAgeSeconds = 20;

export function explorerLocalLedgerRouter(
	config: ExplorerLocalLedgerRouterConfig
): express.Router {
	const router = express.Router();

	router.get('/', async (req, res) => {
		const query = readRangeQuery(req.query.firstLedger, req.query.lastLedger);
		if (query === null) {
			return res.status(400).json({ error: 'Invalid canonical ledger range' });
		}
		setCacheHeader(res);
		try {
			return sendRangeResult(
				res,
				await config.getExplorerLocalLedgers.findRange(query)
			);
		} catch {
			return res
				.status(502)
				.json({ error: 'Canonical ledger range query failed' });
		}
	});

	router.get('/:sequence', async (req, res) => {
		const sequence = readLedgerSequence(req.params.sequence);
		if (sequence === null) {
			return res
				.status(400)
				.json({ error: 'Invalid canonical ledger sequence' });
		}
		setCacheHeader(res);
		try {
			return sendLookupResult(
				res,
				await config.getExplorerLocalLedgers.findBySequence(sequence)
			);
		} catch {
			return res.status(502).json({ error: 'Canonical ledger lookup failed' });
		}
	});

	return router;
}

function sendLookupResult(
	res: express.Response,
	result: ExplorerLocalLedgerLookupDTO
): express.Response {
	if (result.status === 'available') return res.status(200).json(result);
	if (result.status === 'not_found') return res.status(404).json(result);
	return res.status(503).json(result);
}

function sendRangeResult(
	res: express.Response,
	result: ExplorerLocalLedgerRangeDTO
): express.Response {
	return res.status(result.status === 'available' ? 200 : 503).json(result);
}

function readRangeQuery(
	firstValue: unknown,
	lastValue: unknown
): FullHistoryLedgerRangeQuery | null {
	const firstLedger = readLedgerSequence(firstValue);
	const lastLedger = readLedgerSequence(lastValue);
	if (firstLedger === null || lastLedger === null) return null;
	const query = { firstLedger, lastLedger };
	try {
		validateFullHistoryLedgerRangeQuery(query);
		return query;
	} catch {
		return null;
	}
}

function readLedgerSequence(value: unknown): FullHistoryLedgerSequence | null {
	if (typeof value !== 'string' || value.trim() !== value) return null;
	try {
		return fullHistoryLedgerSequence(value);
	} catch {
		return null;
	}
}

function setCacheHeader(res: express.Response): void {
	res.setHeader('Cache-Control', `public, max-age=${cacheMaxAgeSeconds}`);
}
