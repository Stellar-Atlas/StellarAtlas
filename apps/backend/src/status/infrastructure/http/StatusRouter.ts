import express, { Router } from 'express';
import type { Result } from 'neverthrow';
import { GetArchiveQueueStatus } from '../../use-cases/get-archive-queue-status/GetArchiveQueueStatus.js';
import { GetApiStatus } from '../../use-cases/get-api-status/GetApiStatus.js';
import { GetDataFreshnessStatus } from '../../use-cases/get-data-freshness-status/GetDataFreshnessStatus.js';
import { GetStatus } from '../../use-cases/get-status/GetStatus.js';
import { GetWorkerStatus } from '../../use-cases/get-worker-status/GetWorkerStatus.js';

export interface StatusRouterConfig {
	readonly getStatus: GetStatus;
	readonly getApiStatus: GetApiStatus;
	readonly getDataFreshnessStatus: GetDataFreshnessStatus;
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

	statusRouter.get('/archive-queue', async function (_req, res) {
		return sendStatusResult(res, await config.getArchiveQueueStatus.execute());
	});

	statusRouter.get('/workers', async function (_req, res) {
		return sendStatusResult(res, await config.getWorkerStatus.execute());
	});

	return statusRouter;
};

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
