import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type { HistoryArchiveBucketCrossCoverageV1 } from 'shared';
import { ArchiveScanRouterWrapper } from '../ArchiveScanRouter.js';
import { GetArchiveScans } from '@history-scan-coordinator/use-cases/get-archive-scans/GetArchiveScans.js';
import { GetArchiveScanQueue } from '@history-scan-coordinator/use-cases/get-archive-scan-queue/GetArchiveScanQueue.js';
import { GetArchiveScanWorkers } from '@history-scan-coordinator/use-cases/get-archive-scan-workers/GetArchiveScanWorkers.js';
import { GetHistoryArchiveBucketCoverage } from '@history-scan-coordinator/use-cases/get-history-archive-bucket-coverage/GetHistoryArchiveBucketCoverage.js';
import { GetHistoryArchiveObjectEvents } from '@history-scan-coordinator/use-cases/get-history-archive-object-events/GetHistoryArchiveObjectEvents.js';
import { GetHistoryArchiveObjects } from '@history-scan-coordinator/use-cases/get-history-archive-objects/GetHistoryArchiveObjects.js';
import { GetHistoryArchiveObjectSummary } from '@history-scan-coordinator/use-cases/get-history-archive-object-summary/GetHistoryArchiveObjectSummary.js';
import { GetHistoryArchiveState } from '@history-scan-coordinator/use-cases/get-history-archive-state/GetHistoryArchiveState.js';
import { GetLatestScan } from '@history-scan-coordinator/use-cases/get-latest-scan/GetLatestScan.js';
import { GetScanEvidence } from '@history-scan-coordinator/use-cases/get-scan-evidence/GetScanEvidence.js';
import { GetScanLogs } from '@history-scan-coordinator/use-cases/get-scan-logs/GetScanLogs.js';

const bucketHash =
	'4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655';

describe('ArchiveBucketCoverageRouter.integration', () => {
	it('exposes bucket hash coverage across archive roots', async () => {
		const { app, getHistoryArchiveBucketCoverage } = createHarness();
		getHistoryArchiveBucketCoverage.execute.mockResolvedValue(
			ok(createCoverage())
		);

		await request(app)
			.get(`/archive-scans/objects/buckets/${bucketHash}/coverage`)
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body).toMatchObject({
					bucketHash,
					counts: {
						archiveRoots: 2,
						failedCopies: 1,
						verifiedCopies: 1
					},
					archiveRoots: [
						{ archiveUrl: 'https://history-a.example.com' },
						{ archiveUrl: 'https://history-b.example.com' }
					]
				});
			});

		expect(getHistoryArchiveBucketCoverage.execute).toHaveBeenCalledWith(
			bucketHash
		);
	});

	it('rejects invalid bucket hashes before calling the use case', async () => {
		const { app, getHistoryArchiveBucketCoverage } = createHarness();

		await request(app)
			.get('/archive-scans/objects/buckets/not-a-bucket/coverage')
			.expect(400);

		expect(getHistoryArchiveBucketCoverage.execute).not.toHaveBeenCalled();
	});
});

function createHarness() {
	const app = express();
	const getHistoryArchiveBucketCoverage =
		mock<GetHistoryArchiveBucketCoverage>();
	app.use(express.json());
	app.use(
		'/archive-scans',
		ArchiveScanRouterWrapper({
			getArchiveScans: mock<GetArchiveScans>(),
			getArchiveScanQueue: mock<GetArchiveScanQueue>(),
			getArchiveScanWorkers: mock<GetArchiveScanWorkers>(),
			getHistoryArchiveBucketCoverage,
			getHistoryArchiveObjectEvents: mock<GetHistoryArchiveObjectEvents>(),
			getHistoryArchiveObjects: mock<GetHistoryArchiveObjects>(),
			getHistoryArchiveObjectSummary: mock<GetHistoryArchiveObjectSummary>(),
			getHistoryArchiveState: mock<GetHistoryArchiveState>(),
			getLatestScan: mock<GetLatestScan>(),
			getScanEvidence: mock<GetScanEvidence>(),
			getScanLogs: mock<GetScanLogs>()
		})
	);

	return { app, getHistoryArchiveBucketCoverage };
}

function createCoverage(): HistoryArchiveBucketCrossCoverageV1 {
	return {
		archiveRoots: [
			{
				archiveUrl: 'https://history-a.example.com',
				archiveUrlIdentity: 'https://history-a.example.com',
				status: 'verified',
				updatedAt: '2026-07-06T16:00:00.000Z',
				verifiedAt: '2026-07-06T16:00:00.000Z'
			},
			{
				archiveUrl: 'https://history-b.example.com',
				archiveUrlIdentity: 'https://history-b.example.com',
				status: 'failed',
				updatedAt: '2026-07-06T16:02:00.000Z',
				verifiedAt: null
			}
		],
		bucketHash,
		counts: {
			archiveRoots: 2,
			failedCopies: 1,
			pendingCopies: 0,
			scanningCopies: 0,
			totalCopies: 2,
			verifiedCopies: 1
		},
		failedCopies: [],
		generatedAt: '2026-07-06T16:05:00.000Z',
		pendingCopies: [],
		scanningCopies: [],
		verifiedCopies: []
	};
}
