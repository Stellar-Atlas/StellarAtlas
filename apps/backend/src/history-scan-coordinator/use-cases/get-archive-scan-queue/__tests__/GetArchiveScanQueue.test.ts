import { mock, MockProxy } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import type { ScanJobRepository } from '@history-scan-coordinator/domain/ScanJobRepository.js';
import { GetArchiveScanQueue } from '../GetArchiveScanQueue.js';

describe('GetArchiveScanQueue', () => {
	let getArchiveScanQueue: GetArchiveScanQueue;
	let scanJobRepositoryMock: MockProxy<ScanJobRepository>;
	let exceptionLoggerMock: MockProxy<ExceptionLogger>;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		scanJobRepositoryMock = mock<ScanJobRepository>();
		exceptionLoggerMock = mock<ExceptionLogger>();
		getArchiveScanQueue = new GetArchiveScanQueue(
			scanJobRepositoryMock,
			exceptionLoggerMock
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should return queue stats with stale job policy metadata', async () => {
		scanJobRepositoryMock.getQueueStats.mockResolvedValue({
			pendingJobs: 3,
			activeJobs: 2,
			staleJobs: 1,
			totalUnfinishedJobs: 6
		});

		const result = await getArchiveScanQueue.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			pendingJobs: 3,
			activeJobs: 2,
			staleJobs: 1,
			totalUnfinishedJobs: 6,
			generatedAt: '2026-07-03T12:00:00.000Z',
			staleJobAgeMs: 1800000
		});
		expect(scanJobRepositoryMock.getQueueStats).toHaveBeenCalledWith(
			new Date('2026-07-03T11:30:00.000Z')
		);
	});

	it('should log and return repository errors', async () => {
		const error = new Error('database unavailable');
		scanJobRepositoryMock.getQueueStats.mockRejectedValue(error);

		const result = await getArchiveScanQueue.execute();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
		expect(exceptionLoggerMock.captureException).toHaveBeenCalledWith(error);
	});
});
