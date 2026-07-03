import express, { Router } from 'express';
import { param, query, validationResult } from 'express-validator';
import type { Result } from 'neverthrow';
import { getDateFromParam } from '@core/utilities/getDateFromParam.js';
import { isDateString } from '@core/utilities/isDateString.js';
import {
	FbasAnalysisValidationError,
	GetFbasAnalysis,
	maxFbasScanId
} from '../../use-cases/get-fbas-analysis/GetFbasAnalysis.js';
import { GetFbasAnalysisProof } from '../../use-cases/get-fbas-analysis-proof/GetFbasAnalysisProof.js';
import { GetLatestFbasProofSets } from '../../use-cases/get-latest-fbas-proof-sets/GetLatestFbasProofSets.js';
import { GetLatestFbas } from '../../use-cases/get-latest-fbas/GetLatestFbas.js';
import {
	FbasTopTierHistoryValidationError,
	GetTopTierHistory
} from '../../use-cases/get-top-tier-history/GetTopTierHistory.js';

export interface FbasRouterConfig {
	readonly getFbasAnalysis: GetFbasAnalysis;
	readonly getFbasAnalysisProof: GetFbasAnalysisProof;
	readonly getLatestFbasProofSets: GetLatestFbasProofSets;
	readonly getLatestFbas: GetLatestFbas;
	readonly getTopTierHistory: GetTopTierHistory;
}

const fbasCacheMaxAgeSeconds = 10;

export const FbasRouterWrapper = (config: FbasRouterConfig): Router => {
	const fbasRouter = express.Router();

	fbasRouter.get('/latest', async function (_req, res) {
		return sendFbasResult(res, await config.getLatestFbas.execute());
	});

	fbasRouter.get('/blocking-sets/latest', async function (_req, res) {
		return sendFbasResult(
			res,
			await config.getLatestFbasProofSets.execute({
				kind: 'blocking_sets'
			}),
			'Latest FBAS blocking sets not found'
		);
	});

	fbasRouter.get('/splitting-sets/latest', async function (_req, res) {
		return sendFbasResult(
			res,
			await config.getLatestFbasProofSets.execute({
				kind: 'splitting_sets'
			}),
			'Latest FBAS splitting sets not found'
		);
	});

	fbasRouter.get(
		'/analyses/:scanId',
		[param('scanId').isInt({ min: 1, max: maxFbasScanId })],
		async function (req: express.Request, res: express.Response) {
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return res.status(400).json({ errors: errors.array() });
			}

			return sendFbasResult(
				res,
				await config.getFbasAnalysis.execute({
					scanId: Number(req.params.scanId)
				}),
				'FBAS analysis not found'
			);
		}
	);

	fbasRouter.get(
		'/analyses/:scanId/proof',
		[param('scanId').isInt({ min: 1, max: maxFbasScanId })],
		async function (req: express.Request, res: express.Response) {
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return res.status(400).json({ errors: errors.array() });
			}

			return sendFbasResult(
				res,
				await config.getFbasAnalysisProof.execute({
					scanId: Number(req.params.scanId)
				}),
				'FBAS analysis proof not found'
			);
		}
	);

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
	result: Result<T, Error>,
	notFoundMessage = 'Latest FBAS analysis not found'
): express.Response {
	res.setHeader('Cache-Control', 'public, max-age=' + fbasCacheMaxAgeSeconds);

	if (result.isErr()) {
		if (result.error instanceof FbasAnalysisValidationError) {
			return res.status(400).json({ error: result.error.message });
		}
		if (result.error instanceof FbasTopTierHistoryValidationError) {
			return res.status(400).json({ error: result.error.message });
		}
		return res.status(500).json({ error: 'Internal server error' });
	}
	if (result.value === null) {
		return res.status(404).json({ error: notFoundMessage });
	}

	return res.status(200).json(result.value);
}

export { FbasRouterWrapper as fbasRouter };
