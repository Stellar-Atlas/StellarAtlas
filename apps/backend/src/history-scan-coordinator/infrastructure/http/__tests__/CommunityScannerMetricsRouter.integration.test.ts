import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import {
	CommunityScannerRouterWrapper,
	type CommunityScannerRouterConfig
} from '../CommunityScannerRouter.js';
import { RegisterCommunityScanner } from '@history-scan-coordinator/use-cases/RegisterCommunityScanner.js';
import { SendScannerHeartbeat } from '@history-scan-coordinator/use-cases/SendScannerHeartbeat.js';
import { GetScannerMetrics } from '@history-scan-coordinator/use-cases/GetScannerMetrics.js';
import { GetScanJob } from '@history-scan-coordinator/use-cases/get-scan-job/GetScanJob.js';
import { TouchScanJob } from '@history-scan-coordinator/use-cases/touch-scan-job/TouchScanJob.js';
import { RegisterScan } from '@history-scan-coordinator/use-cases/register-scan/RegisterScan.js';

describe('CommunityScannerMetricsRouter.integration', () => {
	let app: express.Application;
	let getScannerMetrics: jest.Mocked<GetScannerMetrics>;

	beforeEach(() => {
		getScannerMetrics = mock<GetScannerMetrics>();
		app = express();
		app.use(
			'/community-scanners',
			CommunityScannerRouterWrapper(createRouterConfig(getScannerMetrics))
		);
	});

	it('should expose safe scanner metrics with a short public cache age', async () => {
		getScannerMetrics.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				heartbeatFreshnessMs: 300000,
				totalScanners: 3,
				activeScanners: 2,
				offlineScanners: 1,
				degradedScanners: 0,
				pendingScanners: 1,
				blacklistedScanners: 0,
				permanentlyBlacklistedScanners: 0,
				temporarilyBlockedScanners: 0,
				claimDeniedByBlockedScanners: 0,
				claimDeniedByActiveJobLimitScanners: 1,
				claimDeniedByProductionScoreScanners: 0,
				claimIneligibleScanners: 1,
				probationaryScanners: 1,
				claimEligibleScanners: 2,
				claimPolicyMaxActiveJobsPerScanner: 1,
				claimPolicyMinJobsForProductionScore: 5,
				claimPolicyMinSuccessRate: 50,
				staleScanJobAgeMs: 1800000,
				averageSuccessRate: 90,
				totalJobsCompleted: 10,
				totalJobsFailed: 1,
				averageCompletionTimeMs: 12000
			})
		);

		await request(app)
			.get('/community-scanners/metrics')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body).toMatchObject({
					totalScanners: 3,
					claimDeniedByActiveJobLimitScanners: 1,
					claimEligibleScanners: 2,
					staleScanJobAgeMs: 1800000
				});
				expect(response.body.contactEmail).toBeUndefined();
				expect(response.body.apiKey).toBeUndefined();
				expect(response.body.apiKeyHash).toBeUndefined();
				expect(response.body.blacklistedUntil).toBeUndefined();
			});
	});

	function createRouterConfig(
		metrics: GetScannerMetrics
	): CommunityScannerRouterConfig {
		return {
			registerCommunityScanner: mock<RegisterCommunityScanner>(),
			sendScannerHeartbeat: mock<SendScannerHeartbeat>(),
			getScannerMetrics: metrics,
			getScanJob: mock<GetScanJob>(),
			touchScanJob: mock<TouchScanJob>(),
			registerScan: mock<RegisterScan>()
		};
	}
});
