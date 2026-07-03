import express, { Router } from 'express';
import { query, validationResult } from 'express-validator';
import type { Result } from 'neverthrow';
import { GetCrossCheckArchives } from '../../use-cases/get-cross-check-archives/GetCrossCheckArchives.js';
import { GetCrossCheckOrganizations } from '../../use-cases/get-cross-check-organizations/GetCrossCheckOrganizations.js';
import { GetCrossCheckSources } from '../../use-cases/get-cross-check-sources/GetCrossCheckSources.js';
import { GetCrossCheckValidators } from '../../use-cases/get-cross-check-validators/GetCrossCheckValidators.js';

export interface CrossCheckRouterConfig {
	readonly getCrossCheckArchives: GetCrossCheckArchives;
	readonly getCrossCheckOrganizations: GetCrossCheckOrganizations;
	readonly getCrossCheckSources: GetCrossCheckSources;
	readonly getCrossCheckValidators: GetCrossCheckValidators;
}

const archiveCrossCheckCacheMaxAgeSeconds = 10;
const organizationCrossCheckCacheMaxAgeSeconds = 30;
const sourceCrossCheckCacheMaxAgeSeconds = 300;
const validatorCrossCheckCacheMaxAgeSeconds = 30;

export const CrossCheckRouterWrapper = (
	config: CrossCheckRouterConfig
): Router => {
	const crossCheckRouter = express.Router();

	crossCheckRouter.get(
		'/organizations',
		[
			query('limit')
				.optional()
				.isInt({ min: 1, max: GetCrossCheckOrganizations.maxLimit })
		],
		async function (req: express.Request, res: express.Response) {
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return res.status(400).json({ errors: errors.array() });
			}

			const limit =
				typeof req.query.limit === 'string'
					? Number(req.query.limit)
					: undefined;

			return sendCrossCheckResult(
				res,
				await config.getCrossCheckOrganizations.execute({ limit }),
				organizationCrossCheckCacheMaxAgeSeconds
			);
		}
	);

	crossCheckRouter.get(
		'/validators',
		[
			query('limit')
				.optional()
				.isInt({ min: 1, max: GetCrossCheckValidators.maxLimit })
		],
		async function (req: express.Request, res: express.Response) {
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return res.status(400).json({ errors: errors.array() });
			}

			const limit =
				typeof req.query.limit === 'string'
					? Number(req.query.limit)
					: undefined;

			return sendCrossCheckResult(
				res,
				await config.getCrossCheckValidators.execute({ limit }),
				validatorCrossCheckCacheMaxAgeSeconds
			);
		}
	);

	crossCheckRouter.get(
		'/archives',
		[
			query('limit')
				.optional()
				.isInt({ min: 1, max: GetCrossCheckArchives.maxLimit })
		],
		async function (req: express.Request, res: express.Response) {
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return res.status(400).json({ errors: errors.array() });
			}

			const limit =
				typeof req.query.limit === 'string'
					? Number(req.query.limit)
					: undefined;

			return sendCrossCheckResult(
				res,
				await config.getCrossCheckArchives.execute({ limit }),
				archiveCrossCheckCacheMaxAgeSeconds
			);
		}
	);

	crossCheckRouter.get('/sources', function (_req, res) {
		return sendCrossCheckResult(
			res,
			config.getCrossCheckSources.execute(),
			sourceCrossCheckCacheMaxAgeSeconds
		);
	});

	return crossCheckRouter;
};

function sendCrossCheckResult<T>(
	res: express.Response,
	result: Result<T, Error>,
	cacheMaxAgeSeconds: number
): express.Response {
	res.setHeader('Cache-Control', 'public, max-age=' + cacheMaxAgeSeconds);

	if (result.isErr()) {
		return res.status(500).json({ error: 'Internal server error' });
	}

	return res.status(200).json(result.value);
}

export { CrossCheckRouterWrapper as crossCheckRouter };
