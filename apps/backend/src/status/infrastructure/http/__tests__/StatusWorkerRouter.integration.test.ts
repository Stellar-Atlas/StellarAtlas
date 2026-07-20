import express from 'express';
import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import request from 'supertest';
import { StatusRouterWrapper } from '../StatusRouter.js';
import { GetArchiveQueueStatus } from '@status/use-cases/get-archive-queue-status/GetArchiveQueueStatus.js';
import { GetApiStatus } from '@status/use-cases/get-api-status/GetApiStatus.js';
import { GetDataQualityStatus } from '@status/use-cases/get-data-quality-status/GetDataQualityStatus.js';
import { GetDataFreshnessStatus } from '@status/use-cases/get-data-freshness-status/GetDataFreshnessStatus.js';
import { GetRollupStatus } from '@status/use-cases/get-rollup-status/GetRollupStatus.js';
import { GetScanLogStatus } from '@status/use-cases/get-scan-log-status/GetScanLogStatus.js';
import { GetScanStatus } from '@status/use-cases/get-scan-status/GetScanStatus.js';
import {
	GetFailoverStatus,
	GetFrontendStatus,
	GetHorizonStatus,
	GetRpcStatus
} from '@status/use-cases/get-service-status/GetServiceStatus.js';
import { GetStatus } from '@status/use-cases/get-status/GetStatus.js';
import { GetWorkerStatus } from '@status/use-cases/get-worker-status/GetWorkerStatus.js';

describe('StatusRouter worker telemetry', () => {
	it('exposes aggregate and bounded per-worker status', async () => {
		const getWorkerStatus = mock<GetWorkerStatus>();
		getWorkerStatus.execute.mockResolvedValue(ok(createWorkerStatus()));
		const app = express();
		app.use(
			'/status',
			StatusRouterWrapper({
				getApiStatus: mock<GetApiStatus>(),
				getArchiveQueueStatus: mock<GetArchiveQueueStatus>(),
				getDataFreshnessStatus: mock<GetDataFreshnessStatus>(),
				getDataQualityStatus: mock<GetDataQualityStatus>(),
				getFailoverStatus: mock<GetFailoverStatus>(),
				getFrontendStatus: mock<GetFrontendStatus>(),
				getHorizonStatus: mock<GetHorizonStatus>(),
				getRollupStatus: mock<GetRollupStatus>(),
				getRpcStatus: mock<GetRpcStatus>(),
				getScanLogStatus: mock<GetScanLogStatus>(),
				getScanStatus: mock<GetScanStatus>(),
				getStatus: mock<GetStatus>(),
				getWorkerStatus
			})
		);

		await request(app)
			.get('/status/workers')
			.expect(200)
			.expect((response) => {
				expect(response.body.archiveWorkers).toMatchObject({
					activeWorkers: 1,
					freshWorkers: 1,
					missingWorkers: 23,
					registeredWorkers: 1,
					telemetryMode: 'per-worker'
				});
				expect(response.body.archiveWorkers.workers[0]).toMatchObject({
					bytesTotal: 8192,
					currentObject: {
						remoteId: '82a309de-a5df-457b-9412-f267ed5e7388',
						source: 'https://archive.example',
						type: 'bucket'
					},
					pid: 4123,
					processGeneration: 2,
					slotIndex: 0,
					stage: 'downloading_bucket',
					workerId: 'object-host-0-0'
				});
			});
	});
});

function createWorkerStatus() {
	return {
		generatedAt: '2026-07-03T12:00:00.000Z',
		status: 'degraded' as const,
		archiveWorkers: {
			status: 'degraded' as const,
			activeWorkers: 1,
			configuredWorkerProcesses: 24,
			freshWorkers: 1,
			idleWorkers: 0,
			lastHeartbeatAt: '2026-07-03T12:00:00.000Z',
			missingWorkers: 23,
			queueActiveWorkers: 1,
			queueStaleWorkers: 0,
			registeredWorkers: 1,
			startupGraceActive: false,
			startupGraceMs: 120_000,
			staleJobAgeMs: 1_800_000,
			staleWorkers: 0,
			telemetryMode: 'per-worker' as const,
			totalTakenJobs: 1,
			workers: [
				{
					bytesDownloaded: 2048,
					bytesTotal: 8192,
					claimAttempt: 3,
					currentObject: {
						remoteId: '82a309de-a5df-457b-9412-f267ed5e7388',
						source: 'https://archive.example',
						type: 'bucket' as const
					},
					heartbeatAgeMs: 1000,
					lastHeartbeatAt: '2026-07-03T11:59:59.000Z',
					lastOutcome: 'verified' as const,
					lastOutcomeAt: '2026-07-03T11:58:00.000Z',
					pid: 4123,
					processGeneration: 2,
					processId: '164f7788-9edb-4bb5-81c1-b928d85a21a5',
					processStartedAt: '2026-07-03T11:00:00.000Z',
					slotIndex: 0,
					stage: 'downloading_bucket' as const,
					status: 'active' as const,
					workerId: 'object-host-0-0'
				}
			]
		},
		communityScanners: {
			status: 'ok' as const,
			totalScanners: 1,
			activeScanners: 1,
			offlineScanners: 0,
			degradedScanners: 0,
			blacklistedScanners: 0,
			heartbeatFreshnessMs: 300_000
		}
	};
}
