import express, { Router } from 'express';
import { param, query, validationResult } from 'express-validator';
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
import {
	registerParsedHistoryRegistrationRoutes,
	type ParsedHistoryRegistrationRouteConfig
} from './ParsedHistoryRegistrationRoutes.js';
import {
	BackfillArchiveMetadata,
	type BackfillArchiveMetadataRequest
} from '../../use-cases/backfill-archive-metadata/BackfillArchiveMetadata.js';
import {
	frontendCacheTags,
	type FrontendRevalidationConfig,
	triggerFrontendRevalidation
} from '@core/services/FrontendRevalidation.js';
import { GetHistoryArchiveObjectJob } from '../../use-cases/get-history-archive-object-job/GetHistoryArchiveObjectJob.js';
import { TouchHistoryArchiveObject } from '../../use-cases/touch-history-archive-object/TouchHistoryArchiveObject.js';
import { CompleteHistoryArchiveObject } from '../../use-cases/complete-history-archive-object/CompleteHistoryArchiveObject.js';
import { FailHistoryArchiveObject } from '../../use-cases/fail-history-archive-object/FailHistoryArchiveObject.js';
import { ReleaseHistoryArchiveObject } from '../../use-cases/release-history-archive-object/ReleaseHistoryArchiveObject.js';
import {
	parseArchiveObjectCompletion,
	parseArchiveObjectFailure,
	parseArchiveObjectProgress,
	parseClaimAttempt
} from './ArchiveObjectJobRequestParsers.js';

export interface HistoryScanRouterConfig
	extends FrontendRevalidationConfig, ParsedHistoryRegistrationRouteConfig {
	getLatestScan: GetLatestScan;
	getScanLogs: GetScanLogs;
	getScanJob: GetScanJob;
	getHistoryArchiveObjectJob: GetHistoryArchiveObjectJob;
	registerScan: RegisterScan;
	releaseScanJob: ReleaseScanJob;
	touchScanJob: TouchScanJob;
	touchHistoryArchiveObject: TouchHistoryArchiveObject;
	completeHistoryArchiveObject: CompleteHistoryArchiveObject;
	failHistoryArchiveObject: FailHistoryArchiveObject;
	releaseHistoryArchiveObject: ReleaseHistoryArchiveObject;
	backfillArchiveMetadata: BackfillArchiveMetadata;
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
		historyScanRouter.get(
			'/archive-object-job',
			basicAuth({
				users: { [config.userName]: config.password },
				challenge: true
			}),
			async (_req: express.Request, res: express.Response) => {
				const result = await config.getHistoryArchiveObjectJob.execute();
				if (result.isErr()) {
					return res.status(500).json({ error: result.error.message });
				}
				if (result.value === null) {
					return res
						.status(204)
						.json({ message: 'No archive object job available' });
				}

				triggerFrontendRevalidation(config, [frontendCacheTags.historyScan]);
				return res.status(200).json(result.value);
			}
		);

	if (config.userName && config.password)
		historyScanRouter.post(
			'/archive-object-job/:remoteId/heartbeat',
			basicAuth({
				users: { [config.userName]: config.password },
				challenge: true
			}),
			[
				param('remoteId')
					.isUUID()
					.withMessage('Invalid archive object remoteId')
			],
			async (req: express.Request, res: express.Response) => {
				const errors = validationResult(req);
				if (!errors.isEmpty()) {
					return res.status(400).json({ errors: errors.array() });
				}

				const progress = parseArchiveObjectProgress(req, res);
				if (progress === null) return;

				const result = await config.touchHistoryArchiveObject.execute(
					req.params.remoteId,
					progress
				);
				if (result.isErr()) {
					return res.status(500).json({ error: result.error.message });
				}
				if (!result.value) {
					return res
						.status(404)
						.json({ error: 'Archive object job not found' });
				}

				return res.status(204).send();
			}
		);

	if (config.userName && config.password)
		historyScanRouter.post(
			'/archive-object-job/:remoteId/complete',
			basicAuth({
				users: { [config.userName]: config.password },
				challenge: true
			}),
			[
				param('remoteId')
					.isUUID()
					.withMessage('Invalid archive object remoteId')
			],
			async (req: express.Request, res: express.Response) => {
				const errors = validationResult(req);
				if (!errors.isEmpty()) {
					return res.status(400).json({ errors: errors.array() });
				}

				const completion = parseArchiveObjectCompletion(req, res);
				if (completion === null) return;

				const result = await config.completeHistoryArchiveObject.execute(
					req.params.remoteId,
					completion
				);
				if (result.isErr()) {
					return res.status(500).json({ error: result.error.message });
				}
				if (!result.value) {
					return res
						.status(404)
						.json({ error: 'Archive object job not found' });
				}

				triggerFrontendRevalidation(config, [frontendCacheTags.historyScan]);
				return res.status(204).send();
			}
		);

	if (config.userName && config.password)
		historyScanRouter.post(
			'/archive-object-job/:remoteId/fail',
			basicAuth({
				users: { [config.userName]: config.password },
				challenge: true
			}),
			[
				param('remoteId')
					.isUUID()
					.withMessage('Invalid archive object remoteId')
			],
			async (req: express.Request, res: express.Response) => {
				const errors = validationResult(req);
				if (!errors.isEmpty()) {
					return res.status(400).json({ errors: errors.array() });
				}

				const failure = parseArchiveObjectFailure(req, res);
				if (failure === null) return;

				const result = await config.failHistoryArchiveObject.execute(
					req.params.remoteId,
					failure
				);
				if (result.isErr()) {
					return res.status(500).json({ error: result.error.message });
				}
				if (!result.value) {
					return res
						.status(404)
						.json({ error: 'Archive object job not found' });
				}

				triggerFrontendRevalidation(config, [frontendCacheTags.historyScan]);
				return res.status(204).send();
			}
		);

	if (config.userName && config.password)
		historyScanRouter.post(
			'/archive-object-job/:remoteId/release',
			basicAuth({
				users: { [config.userName]: config.password },
				challenge: true
			}),
			[
				param('remoteId')
					.isUUID()
					.withMessage('Invalid archive object remoteId')
			],
			async (req: express.Request, res: express.Response) => {
				const errors = validationResult(req);
				if (!errors.isEmpty()) {
					return res.status(400).json({ errors: errors.array() });
				}

				const claimAttempt = parseClaimAttempt(req.body, res);
				if (claimAttempt === null) return;

				const result = await config.releaseHistoryArchiveObject.execute(
					req.params.remoteId,
					claimAttempt
				);
				if (result.isErr()) {
					return res.status(500).json({ error: result.error.message });
				}
				if (!result.value) {
					return res
						.status(404)
						.json({ error: 'Archive object job not found' });
				}

				triggerFrontendRevalidation(config, [frontendCacheTags.historyScan]);
				return res.status(204).send();
			}
		);

	if (config.userName && config.password)
		historyScanRouter.post(
			'/archive-metadata/backfill',
			basicAuth({
				users: { [config.userName]: config.password },
				challenge: true
			}),
			[
				query('limit')
					.optional()
					.isInt({ min: 1, max: BackfillArchiveMetadata.maxLimit })
			],
			async (req: express.Request, res: express.Response) => {
				const errors = validationResult(req);
				if (!errors.isEmpty()) {
					return res.status(400).json({ errors: errors.array() });
				}

				const request: BackfillArchiveMetadataRequest = {
					limit:
						typeof req.query.limit === 'string'
							? Number(req.query.limit)
							: undefined
				};
				const result = await config.backfillArchiveMetadata.execute(request);
				if (result.isErr()) {
					return res.status(500).json({ error: result.error.message });
				}

				triggerFrontendRevalidation(config, [
					frontendCacheTags.historyScan,
					frontendCacheTags.network
				]);

				return res.status(200).json(result.value);
			}
		);

	registerParsedHistoryRegistrationRoutes(historyScanRouter, config);

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

				const result = await config.releaseScanJob.execute(req.params.remoteId);
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
