import express, { Router } from 'express';
import { GetArchiveScanQueue } from '../../use-cases/get-archive-scan-queue/GetArchiveScanQueue.js';

export interface ArchiveScanRouterConfig {
	getArchiveScanQueue: GetArchiveScanQueue;
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

	return archiveScanRouter;
};

export { ArchiveScanRouterWrapper as archiveScanRouter };
