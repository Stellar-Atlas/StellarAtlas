import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import { ArchiveScanRouterWrapper } from '../ArchiveScanRouter.js';
import { GetArchiveScans } from '@history-scan-coordinator/use-cases/get-archive-scans/GetArchiveScans.js';
import { GetArchiveScanQueue } from '@history-scan-coordinator/use-cases/get-archive-scan-queue/GetArchiveScanQueue.js';
import { GetArchiveScanWorkers } from '@history-scan-coordinator/use-cases/get-archive-scan-workers/GetArchiveScanWorkers.js';
import { GetHistoryArchiveBucketCoverage } from '@history-scan-coordinator/use-cases/get-history-archive-bucket-coverage/GetHistoryArchiveBucketCoverage.js';
import { GetHistoryArchiveObjectEvents } from '@history-scan-coordinator/use-cases/get-history-archive-object-events/GetHistoryArchiveObjectEvents.js';
import { GetHistoryArchiveObjects } from '@history-scan-coordinator/use-cases/get-history-archive-objects/GetHistoryArchiveObjects.js';
import { GetHistoryArchiveObjectSummary } from '@history-scan-coordinator/use-cases/get-history-archive-object-summary/GetHistoryArchiveObjectSummary.js';
import { GetHistoryArchiveRepairPlan } from '@history-scan-coordinator/use-cases/get-history-archive-repair-plan/GetHistoryArchiveRepairPlan.js';
import { GetHistoryArchiveState } from '@history-scan-coordinator/use-cases/get-history-archive-state/GetHistoryArchiveState.js';
import { GetLatestScan } from '@history-scan-coordinator/use-cases/get-latest-scan/GetLatestScan.js';
import { GetScanEvidence } from '@history-scan-coordinator/use-cases/get-scan-evidence/GetScanEvidence.js';
import { GetScanLogs } from '@history-scan-coordinator/use-cases/get-scan-logs/GetScanLogs.js';

describe('ArchiveEvidenceRouter.integration', () => {
	it('should expose verified bucket evidence', async () => {
		const { app, getLatestScan, getScanEvidence, getScanLogs } =
			createHarness();
		getScanEvidence.execute.mockResolvedValue(
			ok({
				count: 1,
				evidence: [
					{
						bucketHash:
							'32900289ef7cd0eb0f5982cc58fc489abb1efb53a99de8142d2b68bcc1ec36b8',
						bucketUrl:
							'https://test.com/bucket/32/90/02/bucket-32900289ef7cd0eb0f5982cc58fc489abb1efb53a99de8142d2b68bcc1ec36b8.xdr.gz',
						kind: 'bucket',
						observedAt: '2026-07-03T10:05:00.000Z',
						status: 'verified'
					}
				],
				limit: 10,
				url: 'https://test.com'
			})
		);

		await request(app)
			.get('/archive-scans/https%3A%2F%2Ftest.com/evidence?limit=10')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body.count).toBe(1);
				expect(response.body.evidence[0]).toMatchObject({
					kind: 'bucket',
					status: 'verified'
				});
			});

		expect(getScanEvidence.execute).toHaveBeenCalledWith(
			'https://test.com',
			10
		);
		expect(getLatestScan.execute).not.toHaveBeenCalled();
		expect(getScanLogs.execute).not.toHaveBeenCalled();
	});

	it('should return 400 for invalid evidence limits', async () => {
		const { app, getScanEvidence } = createHarness();

		await request(app)
			.get('/archive-scans/https%3A%2F%2Ftest.com/evidence?limit=5001')
			.expect(400);

		expect(getScanEvidence.execute).not.toHaveBeenCalled();
	});
});

function createHarness() {
	const app = express();
	const getLatestScan = mock<GetLatestScan>();
	const getScanEvidence = mock<GetScanEvidence>();
	const getScanLogs = mock<GetScanLogs>();
	app.use(express.json());
	app.use(
		'/archive-scans',
		ArchiveScanRouterWrapper({
			getArchiveScans: mock<GetArchiveScans>(),
			getArchiveScanQueue: mock<GetArchiveScanQueue>(),
			getArchiveScanWorkers: mock<GetArchiveScanWorkers>(),
			getHistoryArchiveBucketCoverage: mock<GetHistoryArchiveBucketCoverage>(),
			getHistoryArchiveObjectEvents: mock<GetHistoryArchiveObjectEvents>(),
			getHistoryArchiveObjects: mock<GetHistoryArchiveObjects>(),
			getHistoryArchiveObjectSummary: mock<GetHistoryArchiveObjectSummary>(),
			getHistoryArchiveRepairPlan: mock<GetHistoryArchiveRepairPlan>(),
			getHistoryArchiveState: mock<GetHistoryArchiveState>(),
			getLatestScan,
			getScanEvidence,
			getScanLogs
		})
	);

	return { app, getLatestScan, getScanEvidence, getScanLogs };
}
