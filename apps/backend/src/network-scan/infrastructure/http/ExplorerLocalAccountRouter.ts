import express from 'express';
import type { GetExplorerLocalAccountChanges } from '../../use-cases/get-explorer-local-account-changes/GetExplorerLocalAccountChanges.js';
import {
	explorerLocalAccountChangeLimitDefault,
	explorerLocalAccountChangeLimitMaximum,
	validateExplorerLocalAccountChangesQuery
} from '../../use-cases/get-explorer-local-account-changes/GetExplorerLocalAccountChanges.js';

export interface ExplorerLocalAccountRouterConfig {
	readonly getExplorerLocalAccountChanges: Pick<
		GetExplorerLocalAccountChanges,
		'execute'
	>;
}

const cacheMaxAgeSeconds = 20;

export function explorerLocalAccountRouter(
	config: ExplorerLocalAccountRouterConfig
): express.Router {
	const router = express.Router();

	router.get('/:accountId/changes', async (req, res) => {
		const limit = readLimit(req.query.limit);
		if (limit === null) {
			return res.status(400).json({ error: 'Invalid account change limit' });
		}
		const query = { accountId: req.params.accountId, limit };
		try {
			validateExplorerLocalAccountChangesQuery(query);
		} catch {
			return res.status(400).json({ error: 'Invalid local account id' });
		}

		try {
			const result = await config.getExplorerLocalAccountChanges.execute(query);
			res.setHeader(
				'Cache-Control',
				result.status === 'unavailable'
					? 'no-store'
					: `public, max-age=${cacheMaxAgeSeconds}`
			);
			return res
				.status(result.status === 'unavailable' ? 503 : 200)
				.json(result);
		} catch {
			res.setHeader('Cache-Control', 'no-store');
			return res
				.status(502)
				.json({ error: 'Local account observations unavailable' });
		}
	});

	return router;
}

function readLimit(value: unknown): number | null {
	if (value === undefined) return explorerLocalAccountChangeLimitDefault;
	if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) return null;
	const limit = Number(value);
	return Number.isSafeInteger(limit) &&
		limit <= explorerLocalAccountChangeLimitMaximum
		? limit
		: null;
}
