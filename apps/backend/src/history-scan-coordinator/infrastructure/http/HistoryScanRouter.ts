import express, { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import basicAuth from 'express-basic-auth';
import { GetLatestScan } from '../../use-cases/get-latest-scan/GetLatestScan.js';
import { GetScanLogs } from '../../use-cases/get-scan-logs/GetScanLogs.js';
import { InvalidUrlError } from '../../use-cases/get-latest-scan/InvalidUrlError.js';
import { RegisterScan } from '../../use-cases/register-scan/RegisterScan.js';
import { isScanErrorTypeDTO, ScanDTO } from 'history-scanner-dto';
import { GetScanJob } from '../../use-cases/get-scan-job/GetScanJob.js';
import { TouchScanJob } from '../../use-cases/touch-scan-job/TouchScanJob.js';

export interface HistoryScanRouterConfig {
	getLatestScan: GetLatestScan;
	getScanLogs: GetScanLogs;
	getScanJob: GetScanJob;
	registerScan: RegisterScan;
	touchScanJob: TouchScanJob;
	frontendBaseUrl?: string;
	frontendRevalidateToken?: string;
	userName?: string;
	password?: string;
}

export const HistoryScanRouterWrapper = (
	config: HistoryScanRouterConfig
): Router => {
	const historyScanRouter = express.Router();

	const isValidRequestBody = (
		body: unknown
	): body is Record<string, unknown> => {
		return typeof body === 'object' && body !== null;
	};

	if (config.userName && config.password)
		historyScanRouter.post(
			'/',
			basicAuth({
				users: { [config.userName]: config.password },
				challenge: true
			}),
			(
				req: express.Request,
				res: express.Response,
				next: express.NextFunction
			) => {
				if (!isValidRequestBody(req.body)) {
					return res
						.status(400)
						.json({ error: 'Request body must be an object' });
				}
				next();
			},
			[
				body('startDate').isISO8601().withMessage('Invalid startDate'),
				body('endDate').isISO8601().withMessage('Invalid endDate'),
				body('scanChainInitDate')
					.isISO8601()
					.withMessage('Invalid scanChainInitDate'),
				body('baseUrl').isURL().withMessage('Invalid baseUrl'),
				body('latestVerifiedLedger')
					.isInt({ min: 0 })
					.withMessage('latestVerifiedLedger must be a positive integer'),
				body('latestScannedLedger')
					.isInt({ min: 0 })
					.withMessage('latestScannedLedger must be a positive integer'),
				body('latestScannedLedgerHeaderHash').custom((value) => {
					if (value === null) return true;
					return typeof value === 'string';
				}),
				body('concurrency')
					.isInt({ min: 0 })
					.withMessage('concurrency must be a positive integer'),
				body('isSlowArchive')
					.optional()
					.custom((value) => {
						if (value === null) return true;
						return typeof value === 'boolean';
					})
					.withMessage('isSlowArchive must be null or a boolean'),
				body('fromLedger')
					.isInt({ min: 0 })
					.withMessage('fromLedger must be a positive integer'),
				body('toLedger')
					.custom((value) => {
						if (value === null) return true;
						if (Number.isInteger(value) && value >= 0) return true;
						return false;
					})
					.withMessage('toLedger must be null or a positive integer'),
				body('scanJobRemoteId')
					.isString()
					.withMessage('Invalid scan job remoteId'),
				body('error').custom((value) => {
					if (value === null) return true;
					return isValidScanErrorPayload(value);
				}),
				body('errors')
					.optional()
					.isArray()
					.withMessage('errors must be an array'),
				body('errors.*').custom((value) => {
					return isValidScanErrorPayload(value);
				})
			],
			async (req: express.Request, res: express.Response) => {
				const errors = validationResult(req);
				if (!errors.isEmpty()) {
					return res.status(400).json({ errors: errors.array() });
				}

				const dto = ScanDTO.fromJSON(req.body);
				if (dto.isErr()) {
					return res.status(400).json({ error: 'Invalid request body' });
				}
				const result = await config.registerScan.execute(dto.value);

				if (result.isErr()) {
					return res.status(500).json({ error: result.error.message });
				}

				triggerFrontendRevalidation(config, ['history-scan', 'network']);

				return res.status(201).json({ message: 'Scan created successfully' });
			}
		);

	if (config.userName && config.password)
		historyScanRouter.post(
			'/job/:remoteId/heartbeat',
			basicAuth({
				users: { [config.userName]: config.password },
				challenge: true
			}),
			[param('remoteId').isUUID().withMessage('Invalid scan job remoteId')],
			async (req: express.Request, res: express.Response) => {
				const errors = validationResult(req);
				if (!errors.isEmpty()) {
					return res.status(400).json({ errors: errors.array() });
				}

				const result = await config.touchScanJob.execute(req.params.remoteId);
				if (result.isErr()) {
					return res.status(500).json({ error: result.error.message });
				}

				if (!result.value) {
					return res.status(404).json({ error: 'Scan job not found' });
				}

				triggerFrontendRevalidation(config, ['history-scan']);

				return res.status(204).send();
			}
		);

	if (config.userName && config.password)
		historyScanRouter.get(
			'/job',
			basicAuth({
				users: { [config.userName]: config.password },
				challenge: true
			}),
			async (req: express.Request, res: express.Response) => {
				const scanJobResult = await config.getScanJob.execute();

				if (scanJobResult.isErr()) {
					return res.status(500).json({ error: scanJobResult.error.message });
				}

				if (scanJobResult.value === null) {
					return res.status(204).json({ message: 'No scan job available' });
				}

				triggerFrontendRevalidation(config, ['history-scan']);

				return res.json(scanJobResult.value);
			}
		);

	historyScanRouter.get(
		'/logs/:url',
		[param('url').isURL()],
		async function (req: express.Request, res: express.Response) {
			res.setHeader('Cache-Control', 'public, max-age=' + 30);
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return res.status(400).json({ errors: errors.array() });
			}

			const scanLogsOrError = await config.getScanLogs.execute(req.params.url);
			if (
				scanLogsOrError.isErr() &&
				scanLogsOrError.error instanceof InvalidUrlError
			) {
				return res.status(400).json({ error: 'Invalid url' });
			}
			if (scanLogsOrError.isErr()) {
				return res.status(500).json({ error: 'Internal server error' });
			}

			return res.status(200).json(scanLogsOrError.value);
		}
	);

	historyScanRouter.get(
		'/:url',
		[param('url').isURL()],
		async function (req: express.Request, res: express.Response) {
			res.setHeader('Cache-Control', 'public, max-age=' + 60);
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return res.status(400).json({ errors: errors.array() });
			}

			const scanOrError = await config.getLatestScan.execute({
				url: req.params.url
			});

			if (scanOrError.isErr() && scanOrError.error instanceof InvalidUrlError)
				return res.status(400).json({ error: 'Invalid url' });
			if (scanOrError.isErr())
				return res.status(500).json({ error: 'Internal server error' });

			if (scanOrError.value === null)
				return res.status(204).json({ message: 'No scan found for url' });

			return res.status(200).json(scanOrError.value);
		}
	);

	return historyScanRouter;
};

const triggerFrontendRevalidation = (
	config: HistoryScanRouterConfig,
	tags: readonly string[]
): void => {
	if (!config.frontendBaseUrl || !config.frontendRevalidateToken) return;

	let revalidateUrl: URL;
	try {
		revalidateUrl = new URL('/api/revalidate', config.frontendBaseUrl);
	} catch {
		return;
	}

	void fetch(revalidateUrl, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${config.frontendRevalidateToken}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({ tags }),
		signal: AbortSignal.timeout(1500)
	}).catch(() => undefined);
};

export { HistoryScanRouterWrapper as historyScanRouter };

const isValidScanErrorPayload = (value: unknown): boolean => {
	if (typeof value !== 'object' || value === null) return false;

	const candidate = value as Record<string, unknown>;
	return (
		isScanErrorTypeDTO(candidate.type) &&
		typeof candidate.url === 'string' &&
		typeof candidate.message === 'string'
	);
};
