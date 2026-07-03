import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { StatusRouterWrapper } from '../StatusRouter.js';
import { GetArchiveQueueStatus } from '@status/use-cases/get-archive-queue-status/GetArchiveQueueStatus.js';
import { GetApiStatus } from '@status/use-cases/get-api-status/GetApiStatus.js';
import { GetDataFreshnessStatus } from '@status/use-cases/get-data-freshness-status/GetDataFreshnessStatus.js';
import { GetStatus } from '@status/use-cases/get-status/GetStatus.js';
import { GetWorkerStatus } from '@status/use-cases/get-worker-status/GetWorkerStatus.js';

describe('StatusRouter.integration', () => {
	let app: express.Application;
	let getStatus: jest.Mocked<GetStatus>;
	let getApiStatus: jest.Mocked<GetApiStatus>;
	let getDataFreshnessStatus: jest.Mocked<GetDataFreshnessStatus>;
	let getArchiveQueueStatus: jest.Mocked<GetArchiveQueueStatus>;
	let getWorkerStatus: jest.Mocked<GetWorkerStatus>;

	beforeEach(() => {
		getStatus = mock<GetStatus>();
		getApiStatus = mock<GetApiStatus>();
		getDataFreshnessStatus = mock<GetDataFreshnessStatus>();
		getArchiveQueueStatus = mock<GetArchiveQueueStatus>();
		getWorkerStatus = mock<GetWorkerStatus>();
		app = express();
		app.use(
			'/status',
			StatusRouterWrapper({
				getStatus,
				getApiStatus,
				getDataFreshnessStatus,
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
		await request(app).get('/status/data-freshness').expect(200);
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
