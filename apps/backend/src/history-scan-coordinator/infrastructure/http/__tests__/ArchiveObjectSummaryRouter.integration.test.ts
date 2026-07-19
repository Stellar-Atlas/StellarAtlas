import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type {
	HistoryArchiveObjectEventsV1,
	HistoryArchiveObjectQueueV1,
	HistoryArchiveObjectSummaryV1,
	HistoryArchiveStatusSummaryV1,
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
import { GetHistoryArchiveObjectStatusSummary } from '@history-scan-coordinator/use-cases/get-history-archive-object-status-summary/GetHistoryArchiveObjectStatusSummary.js';
import { GetHistoryArchiveRepairArtifact } from '@history-scan-coordinator/use-cases/get-history-archive-repair-artifact/GetHistoryArchiveRepairArtifact.js';
import { GetHistoryArchiveRepairObjectArtifact } from '@history-scan-coordinator/use-cases/get-history-archive-repair-artifact/GetHistoryArchiveRepairObjectArtifact.js';
import { GetHistoryArchiveRepairPlan } from '@history-scan-coordinator/use-cases/get-history-archive-repair-plan/GetHistoryArchiveRepairPlan.js';
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

	it('exposes a separate bounded status summary without object totals', async () => {
		const { app, getHistoryArchiveObjectStatusSummary } = createHarness();
		getHistoryArchiveObjectStatusSummary.execute.mockResolvedValue(
			ok(createStatusSummary())
		);

		await request(app)
			.get('/archive-scans/objects/status-summary')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body).toMatchObject({
					activeObjectChecks: 1,
					sourceCount: 1,
					sourceLimit: 256,
					sourcesTruncated: false
				});
				expect(response.body).not.toHaveProperty('activeObjects');
				expect(response.body).not.toHaveProperty('objectTypes');
			});
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

	it('preserves the legacy V1 archive object evidence contract', async () => {
		const harness = createHarness();
		harness.getHistoryArchiveObjectEvents.execute.mockResolvedValue(
			ok(createEvents())
		);
		harness.getHistoryArchiveObjects.execute.mockResolvedValue(
			ok(createQueue())
		);
		harness.getHistoryArchiveObjectSummary.execute.mockResolvedValue(
			ok(
				createObjectSummary({
					archiveUrl: 'https://history.example.com',
					archiveUrlIdentity: 'https://history.example.com',
					scope: 'archive'
				})
			)
		);
		harness.getHistoryArchiveState.execute.mockResolvedValue(ok(createState()));

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
				expect(response.body).not.toHaveProperty('eventPage');
				expect(response.body).not.toHaveProperty('objectPage');
			});

		expect(harness.getHistoryArchiveObjects.execute).toHaveBeenCalledWith({
			limit: 5,
			url: 'https://history.example.com'
		});
		expect(harness.getHistoryArchiveObjectEvents.execute).toHaveBeenCalledWith({
			limit: 7,
			url: 'https://history.example.com'
		});
	});

	it('preserves the legacy V1 5000-row limits', async () => {
		const harness = createHarness();
		harness.getHistoryArchiveObjectEvents.execute.mockResolvedValue(
			ok(createEvents())
		);
		harness.getHistoryArchiveObjects.execute.mockResolvedValue(
			ok(createQueue())
		);
		harness.getHistoryArchiveObjectSummary.execute.mockResolvedValue(
			ok(createObjectSummary({ scope: 'archive' }))
		);
		harness.getHistoryArchiveState.execute.mockResolvedValue(ok(null));

		await request(harness.app)
			.get(
				'/archive-scans/https%3A%2F%2Fhistory.example.com/object-evidence?objectLimit=5000&eventLimit=5000'
			)
			.expect(200);
		expect(harness.getHistoryArchiveObjects.execute).toHaveBeenCalledWith({
			limit: 5000,
			url: 'https://history.example.com'
		});
		expect(harness.getHistoryArchiveObjectEvents.execute).toHaveBeenCalledWith({
			limit: 5000,
			url: 'https://history.example.com'
		});
	});
});

function createHarness() {
	const app = express();
	const getHistoryArchiveObjectEvents = mock<GetHistoryArchiveObjectEvents>();
	const getHistoryArchiveObjects = mock<GetHistoryArchiveObjects>();
	const getHistoryArchiveObjectSummary = mock<GetHistoryArchiveObjectSummary>();
	const getHistoryArchiveObjectStatusSummary =
		mock<GetHistoryArchiveObjectStatusSummary>();
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
			getHistoryArchiveObjectStatusSummary,
			getHistoryArchiveRepairArtifact: mock<GetHistoryArchiveRepairArtifact>(),
			getHistoryArchiveRepairObjectArtifact:
				mock<GetHistoryArchiveRepairObjectArtifact>(),
			getHistoryArchiveRepairPlan: mock<GetHistoryArchiveRepairPlan>(),
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
		getHistoryArchiveObjectStatusSummary,
		getHistoryArchiveState
	};
}

function createStatusSummary(): HistoryArchiveStatusSummaryV1 {
	return {
		activeObjectChecks: 1,
		archiveEvidenceFailures: 0,
		checkpointCoverage: {
			activeArchiveCheckpoints: 0,
			archiveRootsWithState: 1,
			categoryConsistencyFailedCheckpoints: 0,
			categoryConsistencyNotEvaluatedCheckpoints: 0,
			categoryConsistencyPendingCheckpoints: 1,
			categoryConsistentArchiveCheckpoints: 3,
			completeArchiveCheckpoints: 3,
			discoveryCompleteArchiveRoots: 1,
			expectedArchiveCheckpoints: 4,
			failedArchiveCheckpoints: 0,
			latestCheckpointLedger: 255,
			missingArchiveCheckpoints: 0,
			objectCompleteArchiveCheckpoints: 3,
			oldestCheckpointLedger: 63,
			partialArchiveCheckpoints: 1,
			totalArchiveCheckpoints: 4
		},
		generatedAt: '2026-07-06T15:30:00.000Z',
		sourceCount: 1,
		sourceLimit: 256,
		scannerIssueFailures: 0,
		sources: [
			{
				activeObjectChecks: 1,
				archiveEvidenceFailures: 0,
				archiveUrl: 'https://history.example.com',
				archiveUrlIdentity: 'https://history.example.com',
				currentLedger: 255,
				latestCheckpointLedger: 255,
				latestDiscoveredCheckpointLedger: 255,
				mismatchCheckpointProofs: 0,
				notEvaluableCheckpointProofs: 0,
				objectCompleteCheckpointProofs: 3,
				observedAt: '2026-07-06T15:30:00.000Z',
				pendingCheckpointProofs: 1,
				rootObjectStatus: 'verified',
				rootFailureChannel: null,
				scannerIssueFailures: 0,
				source: 'history-scanner',
				stateStatus: 'available',
				stateUrl:
					'https://history.example.com/.well-known/stellar-history.json',
				totalCheckpointProofs: 4,
				unclassifiedFailures: 0,
				verifiedCheckpointProofs: 3
			}
		],
		sourcesTruncated: false,
		unclassifiedFailures: 0
	};
}

function createState(): HistoryArchiveStateSnapshotV1 {
	return {
		archiveUrl: 'https://history.example.com',
		archiveUrlIdentity: 'https://history.example.com',
		failure: null,
		latestFailure: null,
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
				delayReason: null,
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
		sources: [
			{
				activeObjects: 1,
				archiveUrl: 'https://history.example.com',
				archiveUrlIdentity: 'https://history.example.com',
				currentLedger: 255,
				failedObjects: 1,
				latestCheckpointLedger: 255,
				latestDiscoveredCheckpointLedger: 255,
				objectCompleteCheckpoints: 1,
				observedAt: '2026-07-06T15:30:00.000Z',
				pendingObjects: 3,
				rootObjectStatus: 'verified',
				source: 'history-scanner',
				stateStatus: 'available',
				stateUrl:
					'https://history.example.com/.well-known/stellar-history.json',
				totalObjects: 10,
				verifiedCheckpoints: 0,
				verifiedObjects: 5
			}
		],
		totalObjects: 10,
		verifiedObjects: 5
	};
}
