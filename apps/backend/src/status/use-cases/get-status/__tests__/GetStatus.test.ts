import { mock, MockProxy } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { GetArchiveQueueStatus } from '../../get-archive-queue-status/GetArchiveQueueStatus.js';
import { GetApiStatus } from '../../get-api-status/GetApiStatus.js';
import { GetDataFreshnessStatus } from '../../get-data-freshness-status/GetDataFreshnessStatus.js';
import { GetWorkerStatus } from '../../get-worker-status/GetWorkerStatus.js';
import { GetStatus } from '../GetStatus.js';

describe('GetStatus', () => {
	let getApiStatusMock: MockProxy<GetApiStatus>;
	let getDataFreshnessStatusMock: MockProxy<GetDataFreshnessStatus>;
	let getArchiveQueueStatusMock: MockProxy<GetArchiveQueueStatus>;
	let getWorkerStatusMock: MockProxy<GetWorkerStatus>;
	let getStatus: GetStatus;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		getApiStatusMock = mock<GetApiStatus>();
		getDataFreshnessStatusMock = mock<GetDataFreshnessStatus>();
		getArchiveQueueStatusMock = mock<GetArchiveQueueStatus>();
		getWorkerStatusMock = mock<GetWorkerStatus>();
		getStatus = new GetStatus(
			getApiStatusMock,
			getDataFreshnessStatusMock,
			getArchiveQueueStatusMock,
			getWorkerStatusMock
		);
		getApiStatusMock.execute.mockReturnValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				status: 'ok',
				service: 'api'
			})
		);
		getDataFreshnessStatusMock.execute.mockResolvedValue(
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
		getArchiveQueueStatusMock.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				status: 'ok',
				pendingJobs: 0,
				activeJobs: 0,
				staleJobs: 0,
				totalUnfinishedJobs: 0,
				staleJobAgeMs: 1800000
			})
		);
		getWorkerStatusMock.execute.mockResolvedValue(
			ok({
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
			})
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should aggregate status sections', async () => {
		const result = await getStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			generatedAt: '2026-07-03T12:00:00.000Z',
			status: 'ok',
			api: { status: 'ok' },
			dataFreshness: { status: 'ok' },
			archiveQueue: { status: 'ok' },
			workers: { status: 'ok' }
		});
	});

	it('should surface the worst section status', async () => {
		getArchiveQueueStatusMock.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				status: 'degraded',
				pendingJobs: 0,
				activeJobs: 0,
				staleJobs: 1,
				totalUnfinishedJobs: 1,
				staleJobAgeMs: 1800000
			})
		);

		const result = await getStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().status).toBe('degraded');
	});

	it('should pass through section errors', async () => {
		const error = new Error('freshness unavailable');
		getDataFreshnessStatusMock.execute.mockResolvedValue(err(error));

		const result = await getStatus.execute();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
	});
});
