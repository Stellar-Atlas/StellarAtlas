import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { StatusRouterWrapper } from '../StatusRouter.js';
import { GetArchiveQueueStatus } from '@status/use-cases/get-archive-queue-status/GetArchiveQueueStatus.js';
import { GetApiStatus } from '@status/use-cases/get-api-status/GetApiStatus.js';
import { GetDataQualityStatus } from '@status/use-cases/get-data-quality-status/GetDataQualityStatus.js';
import { GetDataFreshnessStatus } from '@status/use-cases/get-data-freshness-status/GetDataFreshnessStatus.js';
import { GetRollupStatus } from '@status/use-cases/get-rollup-status/GetRollupStatus.js';
import { GetScanStatus } from '@status/use-cases/get-scan-status/GetScanStatus.js';
import {
	GetFailoverStatus,
	GetFrontendStatus,
	GetHorizonStatus,
	GetRpcStatus
} from '@status/use-cases/get-service-status/GetServiceStatus.js';
import { GetStatus } from '@status/use-cases/get-status/GetStatus.js';
import { GetWorkerStatus } from '@status/use-cases/get-worker-status/GetWorkerStatus.js';

describe('StatusRouter.integration', () => {
	let app: express.Application;
	let getStatus: jest.Mocked<GetStatus>;
	let getApiStatus: jest.Mocked<GetApiStatus>;
	let getDataQualityStatus: jest.Mocked<GetDataQualityStatus>;
	let getDataFreshnessStatus: jest.Mocked<GetDataFreshnessStatus>;
	let getScanStatus: jest.Mocked<GetScanStatus>;
	let getRollupStatus: jest.Mocked<GetRollupStatus>;
	let getFrontendStatus: jest.Mocked<GetFrontendStatus>;
	let getHorizonStatus: jest.Mocked<GetHorizonStatus>;
	let getRpcStatus: jest.Mocked<GetRpcStatus>;
	let getFailoverStatus: jest.Mocked<GetFailoverStatus>;
	let getArchiveQueueStatus: jest.Mocked<GetArchiveQueueStatus>;
	let getWorkerStatus: jest.Mocked<GetWorkerStatus>;

	beforeEach(() => {
		getStatus = mock<GetStatus>();
		getApiStatus = mock<GetApiStatus>();
		getDataQualityStatus = mock<GetDataQualityStatus>();
		getDataFreshnessStatus = mock<GetDataFreshnessStatus>();
		getScanStatus = mock<GetScanStatus>();
		getRollupStatus = mock<GetRollupStatus>();
		getFrontendStatus = mock<GetFrontendStatus>();
		getHorizonStatus = mock<GetHorizonStatus>();
		getRpcStatus = mock<GetRpcStatus>();
		getFailoverStatus = mock<GetFailoverStatus>();
		getArchiveQueueStatus = mock<GetArchiveQueueStatus>();
		getWorkerStatus = mock<GetWorkerStatus>();
		app = express();
		app.use(
			'/status',
			StatusRouterWrapper({
				getStatus,
				getApiStatus,
				getDataQualityStatus,
				getDataFreshnessStatus,
				getScanStatus,
				getRollupStatus,
				getFrontendStatus,
				getHorizonStatus,
				getRpcStatus,
				getFailoverStatus,
				getArchiveQueueStatus,
				getWorkerStatus
			})
		);
	});

	it('should expose overall status', async () => {
		getStatus.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				status: 'ok',
				api: {
					generatedAt: '2026-07-03T12:00:00.000Z',
					status: 'ok',
					service: 'api'
				},
				dataFreshness: {
					generatedAt: '2026-07-03T12:00:00.000Z',
					status: 'ok',
					networkScan: {
						status: 'ok',
						latestAt: '2026-07-03T11:55:00.000Z',
						ageMs: 300000,
						staleAfterMs: 3600000
					},
					archiveScan: {
						status: 'ok',
						latestAt: '2026-07-03T11:50:00.000Z',
						ageMs: 600000,
						staleAfterMs: null
					}
				},
				scans: {
					generatedAt: '2026-07-03T12:00:00.000Z',
					status: 'ok',
					networkScan: {
						status: 'ok',
						windowStart: '2026-07-02T12:00:00.000Z',
						windowEnd: '2026-07-03T12:00:00.000Z',
						windowMs: 86400000,
						scanIntervalMs: 180000,
						expectedScans: 480,
						totalScans: 480,
						completedScans: 479,
						incompleteScans: 1,
						completionRate: 99.79,
						expectedCompletionRate: 99.79,
						latestScanAt: '2026-07-03T11:59:00.000Z',
						latestCompletedScanAt: '2026-07-03T11:56:00.000Z'
					}
				},
				rollups: {
					generatedAt: '2026-07-03T12:00:00.000Z',
					status: 'ok',
					networkRollups: {
						status: 'ok',
						windowStart: '2026-06-26T00:00:00.000Z',
						windowEnd: '2026-07-03T00:00:00.000Z',
						windowDays: 7,
						rawCompletedScans: 70,
						rollupCrawlCount: 70,
						daysWithCompletedScans: 7,
						daysWithRollups: 7,
						matchingDays: 7,
						missingRollupDays: 0,
						mismatchedRollupDays: 0,
						latestRollupDay: '2026-07-02T00:00:00.000Z',
						days: []
					}
				},
				archiveQueue: {
					generatedAt: '2026-07-03T12:00:00.000Z',
					status: 'ok',
					pendingJobs: 0,
					activeJobs: 0,
					staleJobs: 0,
					totalUnfinishedJobs: 0,
					staleJobAgeMs: 1800000
				},
				workers: {
					generatedAt: '2026-07-03T12:00:00.000Z',
					status: 'ok',
					archiveWorkers: {
						status: 'ok',
						activeWorkers: 0,
						staleWorkers: 0,
						totalTakenJobs: 0,
						staleJobAgeMs: 1800000
					},
					communityScanners: {
						status: 'ok',
						totalScanners: 0,
						activeScanners: 0,
						offlineScanners: 0,
						degradedScanners: 0,
						blacklistedScanners: 0,
						heartbeatFreshnessMs: 300000
					}
				}
			})
		);

		await request(app)
			.get('/status')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body.status).toBe('ok');
				expect(response.body.archiveQueue).toBeDefined();
			});
	});

	it('should expose individual status sections', async () => {
		getApiStatus.execute.mockReturnValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				status: 'ok',
				service: 'api'
			})
		);
		getDataQualityStatus.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				status: 'ok',
				dataFreshness: {
					generatedAt: '2026-07-03T12:00:00.000Z',
					status: 'ok',
					networkScan: {
						status: 'ok',
						latestAt: '2026-07-03T11:55:00.000Z',
						ageMs: 300000,
						staleAfterMs: 3600000
					},
					archiveScan: {
						status: 'ok',
						latestAt: '2026-07-03T11:50:00.000Z',
						ageMs: 600000,
						staleAfterMs: null
					}
				},
				scans: {
					generatedAt: '2026-07-03T12:00:00.000Z',
					status: 'ok',
					networkScan: {
						status: 'ok',
						windowStart: '2026-07-02T12:00:00.000Z',
						windowEnd: '2026-07-03T12:00:00.000Z',
						windowMs: 86400000,
						scanIntervalMs: 180000,
						expectedScans: 480,
						totalScans: 480,
						completedScans: 479,
						incompleteScans: 1,
						completionRate: 99.79,
						expectedCompletionRate: 99.79,
						latestScanAt: '2026-07-03T11:59:00.000Z',
						latestCompletedScanAt: '2026-07-03T11:56:00.000Z'
					}
				},
				rollups: {
					generatedAt: '2026-07-03T12:00:00.000Z',
					status: 'ok',
					networkRollups: {
						status: 'ok',
						windowStart: '2026-06-26T00:00:00.000Z',
						windowEnd: '2026-07-03T00:00:00.000Z',
						windowDays: 7,
						rawCompletedScans: 70,
						rollupCrawlCount: 70,
						daysWithCompletedScans: 7,
						daysWithRollups: 7,
						matchingDays: 7,
						missingRollupDays: 0,
						mismatchedRollupDays: 0,
						latestRollupDay: '2026-07-02T00:00:00.000Z',
						days: []
					}
				},
				archiveQueue: {
					generatedAt: '2026-07-03T12:00:00.000Z',
					status: 'ok',
					pendingJobs: 0,
					activeJobs: 0,
					staleJobs: 0,
					totalUnfinishedJobs: 0,
					staleJobAgeMs: 1800000
				}
			})
		);
		getDataFreshnessStatus.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				status: 'ok',
				networkScan: {
					status: 'ok',
					latestAt: '2026-07-03T11:55:00.000Z',
					ageMs: 300000,
					staleAfterMs: 3600000
				},
				archiveScan: {
					status: 'ok',
					latestAt: '2026-07-03T11:50:00.000Z',
					ageMs: 600000,
					staleAfterMs: null
				}
			})
		);
		getScanStatus.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				status: 'ok',
				networkScan: {
					status: 'ok',
					windowStart: '2026-07-02T12:00:00.000Z',
					windowEnd: '2026-07-03T12:00:00.000Z',
					windowMs: 86400000,
					scanIntervalMs: 180000,
					expectedScans: 480,
					totalScans: 480,
					completedScans: 479,
					incompleteScans: 1,
					completionRate: 99.79,
					expectedCompletionRate: 99.79,
					latestScanAt: '2026-07-03T11:59:00.000Z',
					latestCompletedScanAt: '2026-07-03T11:56:00.000Z'
				}
			})
		);
		getRollupStatus.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				status: 'ok',
				networkRollups: {
					status: 'ok',
					windowStart: '2026-06-26T00:00:00.000Z',
					windowEnd: '2026-07-03T00:00:00.000Z',
					windowDays: 7,
					rawCompletedScans: 70,
					rollupCrawlCount: 70,
					daysWithCompletedScans: 7,
					daysWithRollups: 7,
					matchingDays: 7,
					missingRollupDays: 0,
					mismatchedRollupDays: 0,
					latestRollupDay: '2026-07-02T00:00:00.000Z',
					days: []
				}
			})
		);
		getFrontendStatus.execute.mockReturnValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				status: 'ok',
				service: 'frontend',
				configured: true,
				url: 'https://stellaratlas.io',
				probe: 'not_run'
			})
		);
		getHorizonStatus.execute.mockReturnValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				status: 'ok',
				service: 'horizon',
				configured: true,
				url: 'https://horizon.example.com',
				probe: 'not_run'
			})
		);
		getRpcStatus.execute.mockReturnValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				status: 'unavailable',
				service: 'rpc',
				configured: false,
				url: null,
				probe: 'not_run'
			})
		);
		getFailoverStatus.execute.mockReturnValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				status: 'unavailable',
				service: 'failover',
				configured: false,
				complete: false,
				frontendUrl: null,
				apiUrl: null,
				probe: 'not_run'
			})
		);
		getArchiveQueueStatus.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				status: 'degraded',
				pendingJobs: 1,
				activeJobs: 0,
				staleJobs: 1,
				totalUnfinishedJobs: 2,
				staleJobAgeMs: 1800000
			})
		);
		getWorkerStatus.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				status: 'ok',
				archiveWorkers: {
					status: 'ok',
					activeWorkers: 1,
					staleWorkers: 0,
					totalTakenJobs: 1,
					staleJobAgeMs: 1800000
				},
				communityScanners: {
					status: 'ok',
					totalScanners: 1,
					activeScanners: 1,
					offlineScanners: 0,
					degradedScanners: 0,
					blacklistedScanners: 0,
					heartbeatFreshnessMs: 300000
				}
			})
		);

		await request(app).get('/status/api').expect(200);
		await request(app)
			.get('/status/data-quality')
			.expect(200)
			.expect((response) => {
				expect(response.body.status).toBe('ok');
				expect(response.body.rollups.networkRollups.matchingDays).toBe(7);
			});
		await request(app).get('/status/data-freshness').expect(200);
		await request(app)
			.get('/status/scans')
			.expect(200)
			.expect((response) => {
				expect(response.body.networkScan.completedScans).toBe(479);
			});
		await request(app)
			.get('/status/rollups')
			.expect(200)
			.expect((response) => {
				expect(response.body.networkRollups.matchingDays).toBe(7);
			});
		await request(app).get('/status/frontend').expect(200);
		await request(app).get('/status/horizon').expect(200);
		await request(app)
			.get('/status/rpc')
			.expect(200)
			.expect((response) => {
				expect(response.body.probe).toBe('not_run');
			});
		await request(app)
			.get('/status/failover')
			.expect(200)
			.expect((response) => {
				expect(response.body.configured).toBe(false);
			});
		await request(app)
			.get('/status/archive-queue')
			.expect(200)
			.expect((response) => {
				expect(response.body.status).toBe('degraded');
			});
		await request(app).get('/status/workers').expect(200);
	});

	it('should map use case failures to 500', async () => {
		getStatus.execute.mockResolvedValue(err(new Error('database unavailable')));

		await request(app)
			.get('/status')
			.expect(500)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Internal server error' });
			});
	});
});
