import { mock, MockProxy } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { GetArchiveScanQueue } from '@history-scan-coordinator/use-cases/get-archive-scan-queue/GetArchiveScanQueue.js';
import { GetArchiveQueueStatus } from '../GetArchiveQueueStatus.js';

describe('GetArchiveQueueStatus', () => {
	let getArchiveScanQueueMock: MockProxy<GetArchiveScanQueue>;
	let getArchiveQueueStatus: GetArchiveQueueStatus;

	beforeEach(() => {
		getArchiveScanQueueMock = mock<GetArchiveScanQueue>();
		getArchiveQueueStatus = new GetArchiveQueueStatus(getArchiveScanQueueMock);
	});

	it('should map queue stats to ok status when no jobs are stale', async () => {
		getArchiveScanQueueMock.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				pendingJobs: 2,
				activeJobs: 1,
				staleJobs: 0,
				totalUnfinishedJobs: 3,
				staleJobAgeMs: 1800000
			})
		);

		const result = await getArchiveQueueStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			deprecated: true,
			drivesPlatformStatus: false,
			drivesRuntimeHealth: false,
			generatedAt: '2026-07-03T12:00:00.000Z',
			historical: true,
			source: 'legacy_range_scan',
			status: 'ok',
			pendingJobs: 2,
			activeJobs: 1,
			staleJobs: 0,
			totalUnfinishedJobs: 3,
			staleJobAgeMs: 1800000
		});
	});

	it('should degrade when stale jobs exist', async () => {
		getArchiveScanQueueMock.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				pendingJobs: 0,
				activeJobs: 0,
				staleJobs: 1,
				totalUnfinishedJobs: 1,
				staleJobAgeMs: 1800000
			})
		);

		const result = await getArchiveQueueStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().status).toBe('degraded');
	});

	it('should pass through queue errors', async () => {
		const error = new Error('queue unavailable');
		getArchiveScanQueueMock.execute.mockResolvedValue(err(error));

		const result = await getArchiveQueueStatus.execute();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
	});
});
