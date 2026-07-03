import express, { Router } from 'express';
import { param, query, validationResult } from 'express-validator';
import {
	handleGetArchiveScanLogs,
	handleGetLatestArchiveScan
} from './HistoryArchiveScanReadHandlers.js';
import { GetArchiveScans } from '../../use-cases/get-archive-scans/GetArchiveScans.js';
import { GetArchiveScanQueue } from '../../use-cases/get-archive-scan-queue/GetArchiveScanQueue.js';
import { GetArchiveScanWorkers } from '../../use-cases/get-archive-scan-workers/GetArchiveScanWorkers.js';
import { GetLatestScan } from '../../use-cases/get-latest-scan/GetLatestScan.js';
import { GetScanLogs } from '../../use-cases/get-scan-logs/GetScanLogs.js';

export interface ArchiveScanRouterConfig {
	getArchiveScans: GetArchiveScans;
	getArchiveScanQueue: GetArchiveScanQueue;
	getArchiveScanWorkers: GetArchiveScanWorkers;
	getLatestScan: GetLatestScan;
	getScanLogs: GetScanLogs;
}

const archiveScanCacheMaxAgeSeconds = 10;

export const ArchiveScanRouterWrapper = (
	config: ArchiveScanRouterConfig
): Router => {
	const archiveScanRouter = express.Router();

	archiveScanRouter.get(
		'/',
		[
			query('limit').optional().isInt({ min: 1, max: GetArchiveScans.maxLimit })
		],
		async function (req: express.Request, res: express.Response) {
			res.setHeader(
				'Cache-Control',
				'public, max-age=' + archiveScanCacheMaxAgeSeconds
			);
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return res.status(400).json({ errors: errors.array() });
			}

			const limit =
				typeof req.query.limit === 'string'
					? Number(req.query.limit)
					: undefined;
			const archiveScansOrError = await config.getArchiveScans.execute({
				limit
			});
			if (archiveScansOrError.isErr()) {
				return res.status(500).json({ error: 'Internal server error' });
			}

			return res.status(200).json(archiveScansOrError.value);
		}
	);

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

	archiveScanRouter.get('/workers', async function (_req, res) {
		res.setHeader(
			'Cache-Control',
			'public, max-age=' + archiveScanCacheMaxAgeSeconds
		);

		const workersOrError = await config.getArchiveScanWorkers.execute();
		if (workersOrError.isErr()) {
			return res.status(500).json({ error: 'Internal server error' });
		}

		return res.status(200).json(workersOrError.value);
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
