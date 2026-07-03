import express, { Router } from 'express';
import type { Result } from 'neverthrow';
import { GetCrossCheckSources } from '../../use-cases/get-cross-check-sources/GetCrossCheckSources.js';

export interface CrossCheckRouterConfig {
	readonly getCrossCheckSources: GetCrossCheckSources;
}

const crossCheckCacheMaxAgeSeconds = 300;

export const CrossCheckRouterWrapper = (
	config: CrossCheckRouterConfig
): Router => {
	const crossCheckRouter = express.Router();

	crossCheckRouter.get('/sources', function (_req, res) {
		return sendCrossCheckResult(res, config.getCrossCheckSources.execute());
	});

	return crossCheckRouter;
};

function sendCrossCheckResult<T>(
	res: express.Response,
	result: Result<T, Error>
): express.Response {
	res.setHeader(
		'Cache-Control',
		'public, max-age=' + crossCheckCacheMaxAgeSeconds
	);

	if (result.isErr()) {
		return res.status(500).json({ error: 'Internal server error' });
	}

	return res.status(200).json(result.value);
}

export { CrossCheckRouterWrapper as crossCheckRouter };
