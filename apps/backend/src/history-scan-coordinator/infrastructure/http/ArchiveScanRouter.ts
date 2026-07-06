import express, { Router } from 'express';
import { param, query, validationResult } from 'express-validator';
import {
	handleGetArchiveScanEvidence,
	handleGetArchiveScanLogs,
	handleGetHistoryArchiveState,
	handleGetLatestArchiveScan
} from './HistoryArchiveScanReadHandlers.js';
import { GetArchiveScans } from '../../use-cases/get-archive-scans/GetArchiveScans.js';
import { GetArchiveScanQueue } from '../../use-cases/get-archive-scan-queue/GetArchiveScanQueue.js';
import { GetArchiveScanWorkers } from '../../use-cases/get-archive-scan-workers/GetArchiveScanWorkers.js';
import { GetLatestScan } from '../../use-cases/get-latest-scan/GetLatestScan.js';
import {
	GetScanEvidence,
	maxEvidenceLimit
} from '../../use-cases/get-scan-evidence/GetScanEvidence.js';
import { GetScanLogs } from '../../use-cases/get-scan-logs/GetScanLogs.js';
import { GetHistoryArchiveState } from '../../use-cases/get-history-archive-state/GetHistoryArchiveState.js';
import { GetHistoryArchiveObjects } from '../../use-cases/get-history-archive-objects/GetHistoryArchiveObjects.js';
import {
	GetHistoryArchiveBucketCoverage,
	InvalidBucketHashError
} from '../../use-cases/get-history-archive-bucket-coverage/GetHistoryArchiveBucketCoverage.js';
import { GetHistoryArchiveObjectSummary } from '../../use-cases/get-history-archive-object-summary/GetHistoryArchiveObjectSummary.js';
import { GetHistoryArchiveObjectEvents } from '../../use-cases/get-history-archive-object-events/GetHistoryArchiveObjectEvents.js';
import { InvalidUrlError } from '../../use-cases/get-latest-scan/InvalidUrlError.js';
import type { HistoryArchiveEvidenceV1 } from 'shared';

export interface ArchiveScanRouterConfig {
	getArchiveScans: GetArchiveScans;
	getArchiveScanQueue: GetArchiveScanQueue;
	getArchiveScanWorkers: GetArchiveScanWorkers;
	getHistoryArchiveBucketCoverage: GetHistoryArchiveBucketCoverage;
	getHistoryArchiveObjectEvents: GetHistoryArchiveObjectEvents;
	getHistoryArchiveObjects: GetHistoryArchiveObjects;
	getHistoryArchiveObjectSummary: GetHistoryArchiveObjectSummary;
	getHistoryArchiveState: GetHistoryArchiveState;
	getLatestScan: GetLatestScan;
	getScanEvidence: GetScanEvidence;
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
		'/objects/buckets/:bucketHash/coverage',
		[param('bucketHash').matches(/^[0-9a-f]{64}$/i)],
		async function (req: express.Request, res: express.Response) {
			res.setHeader(
				'Cache-Control',
				'public, max-age=' + archiveScanCacheMaxAgeSeconds
			);
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return res.status(400).json({ errors: errors.array() });
			}

			const coverageOrError =
				await config.getHistoryArchiveBucketCoverage.execute(
					req.params.bucketHash
				);
			if (
				coverageOrError.isErr() &&
				coverageOrError.error instanceof InvalidBucketHashError
			) {
				return res.status(400).json({ error: 'Invalid bucket hash' });
			}
			if (coverageOrError.isErr()) {
				return res.status(500).json({ error: 'Internal server error' });
			}

			return res.status(200).json(coverageOrError.value);
		}
	);

	archiveScanRouter.get(
		'/objects',
		[query('limit').optional().isInt({ min: 1, max: 5000 })],
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
			const objectsOrError = await config.getHistoryArchiveObjects.execute({
				limit
			});
			if (objectsOrError.isErr()) {
				return res.status(500).json({ error: 'Internal server error' });
			}

			return res.status(200).json(objectsOrError.value);
		}
	);

	archiveScanRouter.get(
		'/objects/summary',
		async function (_req: express.Request, res: express.Response) {
			res.setHeader(
				'Cache-Control',
				'public, max-age=' + archiveScanCacheMaxAgeSeconds
			);
			const summaryOrError =
				await config.getHistoryArchiveObjectSummary.execute();
			if (summaryOrError.isErr()) {
				return res.status(500).json({ error: 'Internal server error' });
			}

			return res.status(200).json(summaryOrError.value);
		}
	);

	archiveScanRouter.get(
		'/objects/events',
		[query('limit').optional().isInt({ min: 1, max: 5000 })],
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
			const eventsOrError = await config.getHistoryArchiveObjectEvents.execute({
				limit
			});
			if (eventsOrError.isErr()) {
				return res.status(500).json({ error: 'Internal server error' });
			}

			return res.status(200).json(eventsOrError.value);
		}
	);

	archiveScanRouter.get(
		'/:encodedUrl/state',
		[param('encodedUrl').isURL()],
		async function (req: express.Request, res: express.Response) {
			return handleGetHistoryArchiveState(req, res, config, 'encodedUrl');
		}
	);

	archiveScanRouter.get(
		'/:encodedUrl/errors',
		[param('encodedUrl').isURL()],
		async function (req: express.Request, res: express.Response) {
			return handleGetArchiveScanLogs(req, res, config, 'encodedUrl');
		}
	);

	archiveScanRouter.get(
		'/:encodedUrl/objects',
		[
			param('encodedUrl').isURL(),
			query('limit').optional().isInt({ min: 1, max: 5000 })
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
			const objectsOrError = await config.getHistoryArchiveObjects.execute({
				limit,
				url: req.params.encodedUrl
			});
			if (
				objectsOrError.isErr() &&
				objectsOrError.error instanceof InvalidUrlError
			) {
				return res.status(400).json({ error: 'Invalid url' });
			}
			if (objectsOrError.isErr()) {
				return res.status(500).json({ error: 'Internal server error' });
			}

			return res.status(200).json(objectsOrError.value);
		}
	);

	archiveScanRouter.get(
		'/:encodedUrl/objects/summary',
		[param('encodedUrl').isURL()],
		async function (req: express.Request, res: express.Response) {
			res.setHeader(
				'Cache-Control',
				'public, max-age=' + archiveScanCacheMaxAgeSeconds
			);
			const errors = validationResult(req);
			if (!errors.isEmpty()) {
				return res.status(400).json({ errors: errors.array() });
			}

			const summaryOrError =
				await config.getHistoryArchiveObjectSummary.execute({
					url: req.params.encodedUrl
				});
			if (
				summaryOrError.isErr() &&
				summaryOrError.error instanceof InvalidUrlError
			) {
				return res.status(400).json({ error: 'Invalid url' });
			}
			if (summaryOrError.isErr()) {
				return res.status(500).json({ error: 'Internal server error' });
			}

			return res.status(200).json(summaryOrError.value);
		}
	);

	archiveScanRouter.get(
		'/:encodedUrl/objects/events',
		[
			param('encodedUrl').isURL(),
			query('limit').optional().isInt({ min: 1, max: 5000 })
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
			const eventsOrError = await config.getHistoryArchiveObjectEvents.execute({
				limit,
				url: req.params.encodedUrl
			});
			if (
				eventsOrError.isErr() &&
				eventsOrError.error instanceof InvalidUrlError
			) {
				return res.status(400).json({ error: 'Invalid url' });
			}
			if (eventsOrError.isErr()) {
				return res.status(500).json({ error: 'Internal server error' });
			}

			return res.status(200).json(eventsOrError.value);
		}
	);

	archiveScanRouter.get(
		'/:encodedUrl/object-evidence',
		[
			param('encodedUrl').isURL(),
			query('objectLimit').optional().isInt({ min: 1, max: 5000 }),
			query('eventLimit').optional().isInt({ min: 1, max: 5000 })
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

			const archiveUrl = req.params.encodedUrl;
			const objectLimit =
				typeof req.query.objectLimit === 'string'
					? Number(req.query.objectLimit)
					: undefined;
			const eventLimit =
				typeof req.query.eventLimit === 'string'
					? Number(req.query.eventLimit)
					: undefined;
			const [state, summary, objects, objectEvents] = await Promise.all([
				config.getHistoryArchiveState.execute(archiveUrl),
				config.getHistoryArchiveObjectSummary.execute({ url: archiveUrl }),
				config.getHistoryArchiveObjects.execute({
					limit: objectLimit,
					url: archiveUrl
				}),
				config.getHistoryArchiveObjectEvents.execute({
					limit: eventLimit,
					url: archiveUrl
				})
			]);

			const invalidUrlResult = [state, summary, objects, objectEvents].find(
				(result) => result.isErr() && result.error instanceof InvalidUrlError
			);
			if (invalidUrlResult !== undefined) {
				return res.status(400).json({ error: 'Invalid url' });
			}

			if (
				state.isErr() ||
				summary.isErr() ||
				objects.isErr() ||
				objectEvents.isErr()
			) {
				return res.status(500).json({ error: 'Internal server error' });
			}

			const evidence: HistoryArchiveEvidenceV1 = {
				archiveUrl,
				generatedAt: new Date().toISOString(),
				objectEvents: objectEvents.value,
				objects: objects.value,
				scannerOwnedState: state.value,
				summary: summary.value
			};

			return res.status(200).json(evidence);
		}
	);

	archiveScanRouter.get(
		'/:encodedUrl/evidence',
		[
			param('encodedUrl').isURL(),
			query('limit').optional().isInt({ min: 1, max: maxEvidenceLimit })
		],
		async function (req: express.Request, res: express.Response) {
			return handleGetArchiveScanEvidence(req, res, config, 'encodedUrl');
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
