import express, { Router } from 'express';
import { param, validationResult } from 'express-validator';
import basicAuth from 'express-basic-auth';
import { GetLatestScan } from '../../use-cases/get-latest-scan/GetLatestScan.js';
import { GetScanLogs } from '../../use-cases/get-scan-logs/GetScanLogs.js';
import { RegisterScan } from '../../use-cases/register-scan/RegisterScan.js';
import { GetScanJob } from '../../use-cases/get-scan-job/GetScanJob.js';
import { ReleaseScanJob } from '../../use-cases/release-scan-job/ReleaseScanJob.js';
import { TouchScanJob } from '../../use-cases/touch-scan-job/TouchScanJob.js';
import {
	handleGetArchiveScanLogs,
	handleGetLatestArchiveScan
} from './HistoryArchiveScanReadHandlers.js';
import {
	parseValidatedScanDto,
	parseScanJobProgressUpdate,
	requireObjectBody,
	scanDtoValidators
} from './ScanRequestValidation.js';
import { ParsedLedgerHeaderBatchDTO } from 'history-scanner-dto';
import { RegisterParsedLedgerHeaders } from '../../use-cases/register-parsed-ledger-headers/RegisterParsedLedgerHeaders.js';
import {
	frontendCacheTags,
	type FrontendRevalidationConfig,
	triggerFrontendRevalidation
} from '@core/services/FrontendRevalidation.js';

export interface HistoryScanRouterConfig extends FrontendRevalidationConfig {
	getLatestScan: GetLatestScan;
	getScanLogs: GetScanLogs;
	getScanJob: GetScanJob;
	registerParsedLedgerHeaders: RegisterParsedLedgerHeaders;
	registerScan: RegisterScan;
	releaseScanJob: ReleaseScanJob;
	touchScanJob: TouchScanJob;
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

				triggerFrontendRevalidation(config, [
					frontendCacheTags.historyScan,
					frontendCacheTags.network
				]);

				return res.status(201).json({ message: 'Scan created successfully' });
			}
		);

	if (config.userName && config.password)
		historyScanRouter.post(
			'/parsed-ledger-headers',
			basicAuth({
				users: { [config.userName]: config.password },
				challenge: true
			}),
			requireObjectBody,
			async (req: express.Request, res: express.Response) => {
				const dtoResult = ParsedLedgerHeaderBatchDTO.fromJSON(req.body);
				if (dtoResult.isErr()) {
					return res.status(400).json({ error: dtoResult.error.message });
				}

				const result = await config.registerParsedLedgerHeaders.execute(
					dtoResult.value
				);
				if (result.isErr()) {
					return res.status(500).json({ error: result.error.message });
				}

				return res
					.status(201)
					.json({ message: 'Parsed ledger headers registered' });
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

				const progress = parseScanJobProgressUpdate(req, res);
				if (progress === null) return;

				const result = await config.touchScanJob.execute(
					req.params.remoteId,
					undefined,
					progress
				);
				if (result.isErr()) {
					return res.status(500).json({ error: result.error.message });
				}

				if (!result.value) {
					return res.status(404).json({ error: 'Scan job not found' });
				}

				triggerFrontendRevalidation(config, [frontendCacheTags.historyScan]);

				return res.status(204).send();
			}
		);

	if (config.userName && config.password)
		historyScanRouter.post(
			'/job/:remoteId/release',
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

				const result = await config.releaseScanJob.execute(
					req.params.remoteId
				);
				if (result.isErr()) {
					return res.status(500).json({ error: result.error.message });
				}

				if (!result.value) {
					return res.status(404).json({ error: 'Scan job not found' });
				}

				triggerFrontendRevalidation(config, [frontendCacheTags.historyScan]);

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

				triggerFrontendRevalidation(config, [frontendCacheTags.historyScan]);

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

export { HistoryScanRouterWrapper as historyScanRouter };
