import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type { HistoryArchiveObjectSummaryV1 } from 'shared';
import { ArchiveScanRouterWrapper } from '../ArchiveScanRouter.js';
import { GetArchiveScans } from '@history-scan-coordinator/use-cases/get-archive-scans/GetArchiveScans.js';
import { GetArchiveScanQueue } from '@history-scan-coordinator/use-cases/get-archive-scan-queue/GetArchiveScanQueue.js';
import { GetArchiveScanWorkers } from '@history-scan-coordinator/use-cases/get-archive-scan-workers/GetArchiveScanWorkers.js';
import { GetHistoryArchiveObjectEvents } from '@history-scan-coordinator/use-cases/get-history-archive-object-events/GetHistoryArchiveObjectEvents.js';
import { GetHistoryArchiveObjects } from '@history-scan-coordinator/use-cases/get-history-archive-objects/GetHistoryArchiveObjects.js';
import { GetHistoryArchiveObjectSummary } from '@history-scan-coordinator/use-cases/get-history-archive-object-summary/GetHistoryArchiveObjectSummary.js';
import { GetHistoryArchiveState } from '@history-scan-coordinator/use-cases/get-history-archive-state/GetHistoryArchiveState.js';
import { GetLatestScan } from '@history-scan-coordinator/use-cases/get-latest-scan/GetLatestScan.js';
import { GetScanEvidence } from '@history-scan-coordinator/use-cases/get-scan-evidence/GetScanEvidence.js';
import { GetScanLogs } from '@history-scan-coordinator/use-cases/get-scan-logs/GetScanLogs.js';

describe('ArchiveObjectSummaryRouter.integration', () => {
	it('should expose global object coverage summary', async () => {
		const { app, getHistoryArchiveObjectSummary } = createHarness();
		getHistoryArchiveObjectSummary.execute.mockResolvedValue(
			ok(createObjectSummary({ scope: 'global' }))
		);

		await request(app)
			.get('/archive-scans/objects/summary')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body).toMatchObject({
					scope: 'global',
					totalObjects: 10,
					checkpoints: {
						expectedArchiveCheckpoints: 4,
						missingArchiveCheckpoints: 1,
						totalArchiveCheckpoints: 3
					}
				});
			});

		expect(getHistoryArchiveObjectSummary.execute).toHaveBeenCalledWith();
	});

	it('should expose archive-scoped object coverage summary', async () => {
		const { app, getHistoryArchiveObjectSummary } = createHarness();
		getHistoryArchiveObjectSummary.execute.mockResolvedValue(
			ok(
				createObjectSummary({
					archiveUrl: 'https://history.example.com',
					archiveUrlIdentity: 'https://history.example.com',
					scope: 'archive'
				})
			)
		);

		await request(app)
			.get('/archive-scans/https%3A%2F%2Fhistory.example.com/objects/summary')
			.expect(200)
			.expect((response) => {
				expect(response.body).toMatchObject({
					archiveUrl: 'https://history.example.com',
					scope: 'archive'
				});
			});

		expect(getHistoryArchiveObjectSummary.execute).toHaveBeenCalledWith({
			url: 'https://history.example.com'
		});
	});

	it('should reject invalid archive-scoped summary URLs', async () => {
		const { app, getHistoryArchiveObjectSummary } = createHarness();

		await request(app)
			.get('/archive-scans/not-a-url/objects/summary')
			.expect(400);

		expect(getHistoryArchiveObjectSummary.execute).not.toHaveBeenCalled();
	});
});

function createHarness() {
	const app = express();
	const getHistoryArchiveObjectSummary = mock<GetHistoryArchiveObjectSummary>();
	app.use(express.json());
	app.use(
		'/archive-scans',
		ArchiveScanRouterWrapper({
			getArchiveScans: mock<GetArchiveScans>(),
			getArchiveScanQueue: mock<GetArchiveScanQueue>(),
			getArchiveScanWorkers: mock<GetArchiveScanWorkers>(),
			getHistoryArchiveObjectEvents: mock<GetHistoryArchiveObjectEvents>(),
			getHistoryArchiveObjects: mock<GetHistoryArchiveObjects>(),
			getHistoryArchiveObjectSummary,
			getHistoryArchiveState: mock<GetHistoryArchiveState>(),
			getLatestScan: mock<GetLatestScan>(),
			getScanEvidence: mock<GetScanEvidence>(),
			getScanLogs: mock<GetScanLogs>()
		})
	);

	return { app, getHistoryArchiveObjectSummary };
}

function createObjectSummary(
	options: Pick<HistoryArchiveObjectSummaryV1, 'scope'> &
		Partial<
			Pick<HistoryArchiveObjectSummaryV1, 'archiveUrl' | 'archiveUrlIdentity'>
		>
): HistoryArchiveObjectSummaryV1 {
	return {
		activeObjects: 1,
		archiveUrl: options.archiveUrl ?? null,
		archiveUrlIdentity: options.archiveUrlIdentity ?? null,
		buckets: {
			activeBucketObjects: 0,
			failedBucketObjects: 1,
			pendingBucketObjects: 2,
			totalBucketObjects: 5,
			uniqueBucketHashes: 4,
			verifiedBucketObjects: 2
		},
		checkpoints: {
			activeArchiveCheckpoints: 1,
			archiveRootsWithState: 1,
			completeArchiveCheckpoints: 1,
			discoveryCompleteArchiveRoots: 0,
			expectedArchiveCheckpoints: 4,
			failedArchiveCheckpoints: 1,
			latestCheckpointLedger: 255,
			missingArchiveCheckpoints: 1,
			oldestCheckpointLedger: 63,
			partialArchiveCheckpoints: 1,
			totalArchiveCheckpoints: 3
		},
		failedObjects: 1,
		generatedAt: '2026-07-06T15:30:00.000Z',
		objectTypes: [
			{
				activeObjects: 1,
				failedObjects: 0,
				objectType: 'checkpoint-state',
				pendingObjects: 2,
				totalObjects: 5,
				verifiedObjects: 2
			}
		],
		pendingObjects: 3,
		scope: options.scope,
		totalObjects: 10,
		verifiedObjects: 5
	};
}
