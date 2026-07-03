import express, { Router } from 'express';
import { param, validationResult } from 'express-validator';
import basicAuth from 'express-basic-auth';
import { GetLatestScan } from '../../use-cases/get-latest-scan/GetLatestScan.js';
import { GetScanLogs } from '../../use-cases/get-scan-logs/GetScanLogs.js';
import { RegisterScan } from '../../use-cases/register-scan/RegisterScan.js';
import { GetScanJob } from '../../use-cases/get-scan-job/GetScanJob.js';
import { TouchScanJob } from '../../use-cases/touch-scan-job/TouchScanJob.js';
import {
	handleGetArchiveScanLogs,
	handleGetLatestArchiveScan
} from './HistoryArchiveScanReadHandlers.js';
import {
	parseValidatedScanDto,
	requireObjectBody,
	scanDtoValidators
} from './ScanRequestValidation.js';

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

	if (config.userName && config.password)
		historyScanRouter.post(
			'/',
			basicAuth({
				users: { [config.userName]: config.password },
				challenge: true
			}),
			requireObjectBody,
			scanDtoValidators,
			async (req: express.Request, res: express.Response) => {
				const dto = parseValidatedScanDto(req, res);
				if (dto === null) return;

				const result = await config.registerScan.execute(dto);

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
			return handleGetArchiveScanLogs(req, res, config, 'url');
		}
	);

	historyScanRouter.get(
		'/:url',
		[param('url').isURL()],
		async function (req: express.Request, res: express.Response) {
			return handleGetLatestArchiveScan(req, res, config, 'url');
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
