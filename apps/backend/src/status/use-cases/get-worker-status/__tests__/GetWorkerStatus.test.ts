import { mock, MockProxy } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import { GetScannerMetrics } from '@history-scan-coordinator/use-cases/GetScannerMetrics.js';
import type { HistoryArchiveObjectRepository } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { GetWorkerStatus } from '../GetWorkerStatus.js';

describe('GetWorkerStatus', () => {
	let getScannerMetricsMock: MockProxy<GetScannerMetrics>;
	let objectRepository: MockProxy<HistoryArchiveObjectRepository>;
	let getWorkerStatus: GetWorkerStatus;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		getScannerMetricsMock = mock<GetScannerMetrics>();
		objectRepository = mock<HistoryArchiveObjectRepository>();
		getWorkerStatus = new GetWorkerStatus(
			getScannerMetricsMock,
			objectRepository
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should expose archive worker and community scanner status', async () => {
		objectRepository.getWorkerSnapshot.mockResolvedValue({
			activeObjects: 2,
			hasPendingObjects: true,
			staleObjects: 0,
			totalScanningObjects: 2
		});
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
				staleJobAgeMs: 120000
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
		objectRepository.getWorkerSnapshot.mockResolvedValue({
			activeObjects: 0,
			hasPendingObjects: true,
			staleObjects: 1,
			totalScanningObjects: 1
		});
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

	it('should degrade when there is pending object work but no active object workers', async () => {
		objectRepository.getWorkerSnapshot.mockResolvedValue({
			activeObjects: 0,
			hasPendingObjects: true,
			staleObjects: 0,
			totalScanningObjects: 0
		});
		getScannerMetricsMock.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				heartbeatFreshnessMs: 300000,
				totalScanners: 1,
				activeScanners: 1,
				offlineScanners: 0,
				degradedScanners: 0,
				pendingScanners: 0,
				blacklistedScanners: 0,
				averageSuccessRate: 100,
				totalJobsCompleted: 1,
				totalJobsFailed: 0,
				averageCompletionTimeMs: 1000
			})
		);

		const result = await getWorkerStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().status).toBe('degraded');
		expect(result._unsafeUnwrap().archiveWorkers).toMatchObject({
			activeWorkers: 0,
			status: 'degraded'
		});
	});

	it('should pass through worker errors', async () => {
		const error = new Error('workers unavailable');
		objectRepository.getWorkerSnapshot.mockRejectedValue(error);
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
