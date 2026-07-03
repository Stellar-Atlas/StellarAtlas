import { mock, MockProxy } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { GetScannerMetrics } from '@history-scan-coordinator/use-cases/GetScannerMetrics.js';
import { GetArchiveScanWorkers } from '@history-scan-coordinator/use-cases/get-archive-scan-workers/GetArchiveScanWorkers.js';
import { GetWorkerStatus } from '../GetWorkerStatus.js';

describe('GetWorkerStatus', () => {
	let getArchiveScanWorkersMock: MockProxy<GetArchiveScanWorkers>;
	let getScannerMetricsMock: MockProxy<GetScannerMetrics>;
	let getWorkerStatus: GetWorkerStatus;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		getArchiveScanWorkersMock = mock<GetArchiveScanWorkers>();
		getScannerMetricsMock = mock<GetScannerMetrics>();
		getWorkerStatus = new GetWorkerStatus(
			getArchiveScanWorkersMock,
			getScannerMetricsMock
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should expose archive worker and community scanner status', async () => {
		getArchiveScanWorkersMock.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				staleJobAgeMs: 1800000,
				activeWorkers: 2,
				staleWorkers: 0,
				totalTakenJobs: 2,
				workers: []
			})
		);
		getScannerMetricsMock.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				heartbeatFreshnessMs: 300000,
				totalScanners: 2,
				activeScanners: 1,
				offlineScanners: 1,
				degradedScanners: 0,
				pendingScanners: 0,
				blacklistedScanners: 0,
				averageSuccessRate: 90,
				totalJobsCompleted: 10,
				totalJobsFailed: 1,
				averageCompletionTimeMs: 15000
			})
		);

		const result = await getWorkerStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			generatedAt: '2026-07-03T12:00:00.000Z',
			status: 'ok',
			archiveWorkers: {
				status: 'ok',
				activeWorkers: 2,
				staleWorkers: 0,
				totalTakenJobs: 2,
				staleJobAgeMs: 1800000
			},
			communityScanners: {
				status: 'ok',
				totalScanners: 2,
				activeScanners: 1,
				offlineScanners: 1,
				degradedScanners: 0,
				blacklistedScanners: 0,
				heartbeatFreshnessMs: 300000
			}
		});
	});

	it('should degrade when stale workers or degraded scanners exist', async () => {
		getArchiveScanWorkersMock.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				staleJobAgeMs: 1800000,
				activeWorkers: 0,
				staleWorkers: 1,
				totalTakenJobs: 1,
				workers: []
			})
		);
		getScannerMetricsMock.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				heartbeatFreshnessMs: 300000,
				totalScanners: 1,
				activeScanners: 0,
				offlineScanners: 1,
				degradedScanners: 1,
				pendingScanners: 0,
				blacklistedScanners: 0,
				averageSuccessRate: 0,
				totalJobsCompleted: 0,
				totalJobsFailed: 1,
				averageCompletionTimeMs: 0
			})
		);

		const result = await getWorkerStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().status).toBe('degraded');
		expect(result._unsafeUnwrap().archiveWorkers.status).toBe('degraded');
		expect(result._unsafeUnwrap().communityScanners.status).toBe('degraded');
	});

	it('should pass through worker errors', async () => {
		const error = new Error('workers unavailable');
		getArchiveScanWorkersMock.execute.mockResolvedValue(err(error));
		getScannerMetricsMock.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				heartbeatFreshnessMs: 300000,
				totalScanners: 0,
				activeScanners: 0,
				offlineScanners: 0,
				degradedScanners: 0,
				pendingScanners: 0,
				blacklistedScanners: 0,
				averageSuccessRate: 0,
				totalJobsCompleted: 0,
				totalJobsFailed: 0,
				averageCompletionTimeMs: 0
			})
		);

		const result = await getWorkerStatus.execute();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
	});
});
