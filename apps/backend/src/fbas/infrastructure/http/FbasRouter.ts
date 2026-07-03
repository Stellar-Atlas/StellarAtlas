import express, { Router } from 'express';
import { query, validationResult } from 'express-validator';
import type { Result } from 'neverthrow';
import { getDateFromParam } from '@core/utilities/getDateFromParam.js';
import { isDateString } from '@core/utilities/isDateString.js';
import { GetLatestFbas } from '../../use-cases/get-latest-fbas/GetLatestFbas.js';
import {
	FbasTopTierHistoryValidationError,
	GetTopTierHistory
} from '../../use-cases/get-top-tier-history/GetTopTierHistory.js';

export interface FbasRouterConfig {
	readonly getLatestFbas: GetLatestFbas;
	readonly getTopTierHistory: GetTopTierHistory;
}

const fbasCacheMaxAgeSeconds = 10;

export const FbasRouterWrapper = (config: FbasRouterConfig): Router => {
	const fbasRouter = express.Router();

	fbasRouter.get('/latest', async function (_req, res) {
		return sendFbasResult(res, await config.getLatestFbas.execute());
	});

	fbasRouter.get(
		'/top-tier/history',
		[query('from').custom(isDateString), query('to').custom(isDateString)],
		async function (req: express.Request, res: express.Response) {
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return res.status(400).json({ errors: errors.array() });
			}

			return sendFbasResult(
				res,
				await config.getTopTierHistory.execute({
					from: getDateFromParam(req.query.from),
					to: getDateFromParam(req.query.to)
				})
			);
		}
	);

	return fbasRouter;
};

function sendFbasResult<T>(
	res: express.Response,
	result: Result<T, Error>
): express.Response {
	res.setHeader('Cache-Control', 'public, max-age=' + fbasCacheMaxAgeSeconds);

	if (result.isErr()) {
		if (result.error instanceof FbasTopTierHistoryValidationError) {
			return res.status(400).json({ error: result.error.message });
		}
		return res.status(500).json({ error: 'Internal server error' });
	}
	if (result.value === null) {
		return res.status(404).json({ error: 'Latest FBAS analysis not found' });
	}

	return res.status(200).json(result.value);
}

export { FbasRouterWrapper as fbasRouter };
