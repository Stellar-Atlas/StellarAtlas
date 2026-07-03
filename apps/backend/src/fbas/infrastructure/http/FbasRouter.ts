import express, { Router } from 'express';
import type { Result } from 'neverthrow';
import { GetLatestFbas } from '../../use-cases/get-latest-fbas/GetLatestFbas.js';

export interface FbasRouterConfig {
	readonly getLatestFbas: GetLatestFbas;
}

const fbasCacheMaxAgeSeconds = 10;

export const FbasRouterWrapper = (config: FbasRouterConfig): Router => {
	const fbasRouter = express.Router();

	fbasRouter.get('/latest', async function (_req, res) {
		return sendFbasResult(res, await config.getLatestFbas.execute());
	});

	return fbasRouter;
};

function sendFbasResult<T>(
	res: express.Response,
	result: Result<T, Error>
): express.Response {
	res.setHeader('Cache-Control', 'public, max-age=' + fbasCacheMaxAgeSeconds);

	if (result.isErr()) {
		return res.status(500).json({ error: 'Internal server error' });
	}
	if (result.value === null) {
		return res.status(404).json({ error: 'Latest FBAS analysis not found' });
	}

	return res.status(200).json(result.value);
}

export { FbasRouterWrapper as fbasRouter };
