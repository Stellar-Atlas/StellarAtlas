import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type {
	HistoryArchiveObjectEventsV1,
	HistoryArchiveObjectQueueV1,
	HistoryArchiveObjectSummaryV1,
	HistoryArchiveStateSnapshotV1
} from 'shared';
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
					hostThrottles: [
						{
							failureClass: 'rate-limit',
							hostIdentity: 'history.example.com'
						}
					],
					checkpoints: {
						categoryConsistentArchiveCheckpoints: 0,
						expectedArchiveCheckpoints: 4,
						missingArchiveCheckpoints: 1,
						objectCompleteArchiveCheckpoints: 1,
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

	it('should compose scanner-owned object evidence for an archive root', async () => {
		const harness = createHarness();
		harness.getHistoryArchiveState.execute.mockResolvedValue(ok(createState()));
		harness.getHistoryArchiveObjectSummary.execute.mockResolvedValue(
			ok(
				createObjectSummary({
					archiveUrl: 'https://history.example.com',
					archiveUrlIdentity: 'https://history.example.com',
					scope: 'archive'
				})
			)
		);
		harness.getHistoryArchiveObjects.execute.mockResolvedValue(
			ok(createQueue())
		);
		harness.getHistoryArchiveObjectEvents.execute.mockResolvedValue(
			ok(createEvents())
		);

		await request(harness.app)
			.get(
				'/archive-scans/https%3A%2F%2Fhistory.example.com/object-evidence?objectLimit=5&eventLimit=7'
			)
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body).toMatchObject({
					archiveUrl: 'https://history.example.com',
					objectEvents: { count: 1 },
					objects: { activeObjects: 1 },
					scannerOwnedState: { status: 'available' },
					summary: { scope: 'archive' }
				});
			});

		expect(harness.getHistoryArchiveState.execute).toHaveBeenCalledWith(
			'https://history.example.com'
		);
		expect(harness.getHistoryArchiveObjectSummary.execute).toHaveBeenCalledWith(
			{
				url: 'https://history.example.com'
			}
		);
		expect(harness.getHistoryArchiveObjects.execute).toHaveBeenCalledWith({
			limit: 5,
			url: 'https://history.example.com'
		});
		expect(harness.getHistoryArchiveObjectEvents.execute).toHaveBeenCalledWith({
			limit: 7,
			url: 'https://history.example.com'
		});
	});
});

function createHarness() {
	const app = express();
	const getHistoryArchiveObjectEvents = mock<GetHistoryArchiveObjectEvents>();
	const getHistoryArchiveObjects = mock<GetHistoryArchiveObjects>();
	const getHistoryArchiveObjectSummary = mock<GetHistoryArchiveObjectSummary>();
	const getHistoryArchiveState = mock<GetHistoryArchiveState>();
	app.use(express.json());
	app.use(
		'/archive-scans',
		ArchiveScanRouterWrapper({
			getArchiveScans: mock<GetArchiveScans>(),
			getArchiveScanQueue: mock<GetArchiveScanQueue>(),
			getArchiveScanWorkers: mock<GetArchiveScanWorkers>(),
			getHistoryArchiveBucketCoverage: mock<GetHistoryArchiveBucketCoverage>(),
			getHistoryArchiveObjectEvents,
			getHistoryArchiveObjects,
			getHistoryArchiveObjectSummary,
			getHistoryArchiveState,
			getLatestScan: mock<GetLatestScan>(),
			getScanEvidence: mock<GetScanEvidence>(),
			getScanLogs: mock<GetScanLogs>()
		})
	);

	return {
		app,
		getHistoryArchiveObjectEvents,
		getHistoryArchiveObjects,
		getHistoryArchiveObjectSummary,
		getHistoryArchiveState
	};
}

function createState(): HistoryArchiveStateSnapshotV1 {
	return {
		archiveUrl: 'https://history.example.com',
		archiveUrlIdentity: 'https://history.example.com',
		failure: null,
		metadata: null,
		observedAt: '2026-07-06T15:30:00.000Z',
		source: 'history-scanner',
		stateUrl: 'https://history.example.com/.well-known/stellar-history.json',
		status: 'available'
	};
}

function createQueue(): HistoryArchiveObjectQueueV1 {
	return {
		activeObjects: 1,
		failedObjects: 0,
		generatedAt: '2026-07-06T15:30:00.000Z',
		objects: [
			{
				archiveUrl: 'https://history.example.com',
				archiveUrlIdentity: 'https://history.example.com',
				attempts: 1,
				bucketHash:
					'4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655',
				bytesDownloaded: 392000,
				checkpointLedger: null,
				claimedAt: '2026-07-06T15:29:00.000Z',
				error: null,
				nextAttemptAt: null,
				objectKey:
					'bucket:4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655',
				objectType: 'bucket',
				objectUrl:
					'https://history.example.com/bucket/4e/ae/73/bucket-4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655.xdr.gz',
				refreshAfter: null,
				remoteId: '11111111-1111-4111-8111-111111111111',
				status: 'scanning',
				updatedAt: '2026-07-06T15:30:00.000Z',
				verificationFacts: null,
				verifiedAt: null,
				workerStage: 'downloading_bucket'
			}
		],
		pendingObjects: 2,
		verifiedObjects: 3
	};
}

function createEvents(): HistoryArchiveObjectEventsV1 {
	return {
		count: 1,
		events: [
			{
				archiveUrl: 'https://history.example.com',
				archiveUrlIdentity: 'https://history.example.com',
				bucketHash: null,
				bytesDownloaded: null,
				checkpointLedger: 127,
				claimAttempt: 1,
				createdAt: '2026-07-06T15:30:00.000Z',
				error: null,
				eventType: 'claimed',
				evidenceClass: null,
				nextAttemptAt: null,
				objectKey: 'ledger:0000007f',
				objectRemoteId: '11111111-1111-4111-8111-111111111111',
				objectType: 'ledger',
				objectUrl:
					'https://history.example.com/ledger/00/00/00/ledger-0000007f.xdr.gz',
				remoteId: '22222222-2222-4222-8222-222222222222',
				verificationFacts: null,
				workerStage: 'claimed'
			}
		],
		generatedAt: '2026-07-06T15:30:00.000Z',
		limit: 7
	};
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
			categoryConsistencyFailedCheckpoints: 0,
			categoryConsistencyNotEvaluatedCheckpoints: 1,
			categoryConsistencyPendingCheckpoints: 1,
			categoryConsistentArchiveCheckpoints: 0,
			completeArchiveCheckpoints: 1,
			discoveryCompleteArchiveRoots: 0,
			expectedArchiveCheckpoints: 4,
			failedArchiveCheckpoints: 1,
			latestCheckpointLedger: 255,
			missingArchiveCheckpoints: 1,
			objectCompleteArchiveCheckpoints: 1,
			oldestCheckpointLedger: 63,
			partialArchiveCheckpoints: 1,
			totalArchiveCheckpoints: 3
		},
		failedObjects: 1,
		generatedAt: '2026-07-06T15:30:00.000Z',
		hostThrottles: [
			{
				archiveUrlIdentity: 'https://history.example.com',
				blockedUntil: '2026-07-06T16:00:00.000Z',
				consecutiveFailures: 3,
				errorType: 'archive_http_error',
				evidenceClass: 'archive-object',
				failureClass: 'rate-limit',
				hostIdentity: 'history.example.com',
				httpStatus: 429,
				lastFailureAt: '2026-07-06T15:30:00.000Z'
			}
		],
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
