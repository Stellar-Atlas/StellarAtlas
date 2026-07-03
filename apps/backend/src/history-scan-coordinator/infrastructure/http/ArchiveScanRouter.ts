import express, { Router } from 'express';
import { param } from 'express-validator';
import {
	handleGetArchiveScanLogs,
	handleGetLatestArchiveScan
} from './HistoryArchiveScanReadHandlers.js';
import { GetArchiveScanQueue } from '../../use-cases/get-archive-scan-queue/GetArchiveScanQueue.js';
import { GetLatestScan } from '../../use-cases/get-latest-scan/GetLatestScan.js';
import { GetScanLogs } from '../../use-cases/get-scan-logs/GetScanLogs.js';

export interface ArchiveScanRouterConfig {
	getArchiveScanQueue: GetArchiveScanQueue;
	getLatestScan: GetLatestScan;
	getScanLogs: GetScanLogs;
}

const archiveScanCacheMaxAgeSeconds = 10;

export const ArchiveScanRouterWrapper = (
	config: ArchiveScanRouterConfig
): Router => {
	const archiveScanRouter = express.Router();

	archiveScanRouter.get('/queue', async function (_req, res) {
		res.setHeader(
			'Cache-Control',
			'public, max-age=' + archiveScanCacheMaxAgeSeconds
		);

		const queueOrError = await config.getArchiveScanQueue.execute();
		if (queueOrError.isErr()) {
			return res.status(500).json({ error: 'Internal server error' });
		}

		return res.status(200).json(queueOrError.value);
	});

	archiveScanRouter.get(
		'/:encodedUrl/errors',
		[param('encodedUrl').isURL()],
		async function (req: express.Request, res: express.Response) {
			return handleGetArchiveScanLogs(req, res, config, 'encodedUrl');
		}
	);

	archiveScanRouter.get(
		'/:encodedUrl',
		[param('encodedUrl').isURL()],
		async function (req: express.Request, res: express.Response) {
			return handleGetLatestArchiveScan(req, res, config, 'encodedUrl');
		}
	);

	return archiveScanRouter;
};

export { ArchiveScanRouterWrapper as archiveScanRouter };
