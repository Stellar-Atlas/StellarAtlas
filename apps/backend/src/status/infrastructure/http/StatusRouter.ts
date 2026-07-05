import express, { Router } from 'express';
import type { Result } from 'neverthrow';
import { GetArchiveQueueStatus } from '../../use-cases/get-archive-queue-status/GetArchiveQueueStatus.js';
import { GetApiStatus } from '../../use-cases/get-api-status/GetApiStatus.js';
import { GetDataQualityStatus } from '../../use-cases/get-data-quality-status/GetDataQualityStatus.js';
import { GetDataFreshnessStatus } from '../../use-cases/get-data-freshness-status/GetDataFreshnessStatus.js';
import { GetRollupStatus } from '../../use-cases/get-rollup-status/GetRollupStatus.js';
import { GetScanLogStatus } from '../../use-cases/get-scan-log-status/GetScanLogStatus.js';
import { GetScanStatus } from '../../use-cases/get-scan-status/GetScanStatus.js';
import {
	GetFailoverStatus,
	GetFrontendStatus,
	GetHorizonStatus,
	GetRpcStatus
} from '../../use-cases/get-service-status/GetServiceStatus.js';
import { GetStatus } from '../../use-cases/get-status/GetStatus.js';
import { GetWorkerStatus } from '../../use-cases/get-worker-status/GetWorkerStatus.js';

export interface StatusRouterConfig {
	readonly getStatus: GetStatus;
	readonly getApiStatus: GetApiStatus;
	readonly getDataQualityStatus: GetDataQualityStatus;
	readonly getDataFreshnessStatus: GetDataFreshnessStatus;
	readonly getScanLogStatus: GetScanLogStatus;
	readonly getScanStatus: GetScanStatus;
	readonly getRollupStatus: GetRollupStatus;
	readonly getFrontendStatus: GetFrontendStatus;
	readonly getHorizonStatus: GetHorizonStatus;
	readonly getRpcStatus: GetRpcStatus;
	readonly getFailoverStatus: GetFailoverStatus;
	readonly getArchiveQueueStatus: GetArchiveQueueStatus;
	readonly getWorkerStatus: GetWorkerStatus;
}

const statusCacheMaxAgeSeconds = 10;

export const StatusRouterWrapper = (config: StatusRouterConfig): Router => {
	const statusRouter = express.Router();

	statusRouter.get('/', async function (_req, res) {
		return sendStatusResult(res, await config.getStatus.execute());
	});

	statusRouter.get('/api', function (_req, res) {
		return sendStatusResult(res, config.getApiStatus.execute());
	});

	statusRouter.get('/data-freshness', async function (_req, res) {
		return sendStatusResult(res, await config.getDataFreshnessStatus.execute());
	});

	statusRouter.get('/data-quality', async function (_req, res) {
		return sendStatusResult(res, await config.getDataQualityStatus.execute());
	});

	statusRouter.get('/scans', async function (_req, res) {
		return sendStatusResult(res, await config.getScanStatus.execute());
	});

	statusRouter.get('/scan-logs', async function (req, res) {
		return sendStatusResult(
			res,
			await config.getScanLogStatus.execute(parseLimit(req.query.limit))
		);
	});

	statusRouter.get('/rollups', async function (_req, res) {
		return sendStatusResult(res, await config.getRollupStatus.execute());
	});

	statusRouter.get('/frontend', function (_req, res) {
		return sendStatusResult(res, config.getFrontendStatus.execute());
	});

	statusRouter.get('/horizon', function (_req, res) {
		return sendStatusResult(res, config.getHorizonStatus.execute());
	});

	statusRouter.get('/rpc', function (_req, res) {
		return sendStatusResult(res, config.getRpcStatus.execute());
	});

	statusRouter.get('/failover', function (_req, res) {
		return sendStatusResult(res, config.getFailoverStatus.execute());
	});

	statusRouter.get('/archive-queue', async function (_req, res) {
		return sendStatusResult(res, await config.getArchiveQueueStatus.execute());
	});

	statusRouter.get('/workers', async function (_req, res) {
		return sendStatusResult(res, await config.getWorkerStatus.execute());
	});

	return statusRouter;
};

function parseLimit(value: unknown): number | undefined {
	if (typeof value !== 'string') return undefined;
	if (!/^\d+$/.test(value)) return undefined;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function sendStatusResult<T>(
	res: express.Response,
	result: Result<T, Error>
): express.Response {
	res.setHeader('Cache-Control', 'public, max-age=' + statusCacheMaxAgeSeconds);

	if (result.isErr()) {
		return res.status(500).json({ error: 'Internal server error' });
	}

	return res.status(200).json(result.value);
}

export { StatusRouterWrapper as statusRouter };
