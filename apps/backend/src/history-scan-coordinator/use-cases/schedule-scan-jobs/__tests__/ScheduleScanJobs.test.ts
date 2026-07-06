import { mock, type MockProxy } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import type { ScanJobRepository } from '@history-scan-coordinator/domain/ScanJobRepository.js';
import type { Logger } from 'logger';
import { ScheduleHistoryArchiveObjects } from '../../schedule-history-archive-objects/ScheduleHistoryArchiveObjects.js';
import { ScheduleScanJobs } from '../ScheduleScanJobs.js';

describe('ScheduleScanJobs', () => {
	let objectSchedulerMock: MockProxy<ScheduleHistoryArchiveObjects>;
	let scanJobRepositoryMock: MockProxy<ScanJobRepository>;
	let loggerMock: MockProxy<Logger>;
	let scheduleScanJobs: ScheduleScanJobs;

	beforeEach(() => {
		objectSchedulerMock = mock<ScheduleHistoryArchiveObjects>();
		scanJobRepositoryMock = mock<ScanJobRepository>();
		loggerMock = mock<Logger>();
		scanJobRepositoryMock.withSchedulingLock.mockImplementation(async (work) =>
			work()
		);
		scanJobRepositoryMock.releaseStaleTakenJobs.mockResolvedValue(0);
		objectSchedulerMock.execute.mockResolvedValue(
			ok({
				discoveredArchiveUrlCount: 2,
				duplicateSuppressedArchiveScanJobCount: 1,
				scheduledArchiveScanJobCount: 1,
				schedulerErrorCount: 0
			})
		);

		scheduleScanJobs = new ScheduleScanJobs(
			scanJobRepositoryMock,
			loggerMock,
			objectSchedulerMock
		);
	});

	it('schedules archive objects inside the scheduler lock', async () => {
		const result = await scheduleScanJobs.execute({
			historyArchiveUrls: ['https://a.example', 'https://b.example']
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) fail(result.error);
		expect(result.value).toEqual({
			discoveredArchiveUrlCount: 2,
			duplicateSuppressedArchiveScanJobCount: 1,
			scheduledArchiveScanJobCount: 1,
			schedulerErrorCount: 0
		});
		expect(scanJobRepositoryMock.withSchedulingLock).toHaveBeenCalledTimes(1);
		expect(objectSchedulerMock.execute).toHaveBeenCalledWith([
			'https://a.example',
			'https://b.example'
		]);
	});

	it('releases stale legacy range jobs before object scheduling', async () => {
		scanJobRepositoryMock.releaseStaleTakenJobs.mockResolvedValue(3);

		const result = await scheduleScanJobs.execute({
			historyArchiveUrls: ['https://example.com']
		});

		expect(result.isOk()).toBe(true);
		expect(scanJobRepositoryMock.releaseStaleTakenJobs).toHaveBeenCalledTimes(1);
		expect(loggerMock.info).toHaveBeenCalledWith(
			'Released stale legacy archive range jobs',
			{
				app: 'history-scan-coordinator',
				released: 3
			}
		);
	});

	it('returns an error when the object scheduler fails', async () => {
		const error = new Error('object scheduling failed');
		objectSchedulerMock.execute.mockResolvedValue(err(error));

		const result = await scheduleScanJobs.execute({
			historyArchiveUrls: ['https://example.com']
		});

		expect(result.isErr()).toBe(true);
		expect(loggerMock.error).toHaveBeenCalledWith(
			'Failed to schedule history archive objects',
			{
				app: 'history-scan-coordinator',
				errorMessage: error.message
			}
		);
	});

	it('returns an error when scheduler locking fails', async () => {
		const error = new Error('lock unavailable');
		scanJobRepositoryMock.withSchedulingLock.mockRejectedValue(error);

		const result = await scheduleScanJobs.execute({
			historyArchiveUrls: ['https://example.com']
		});

		expect(result.isErr()).toBe(true);
		expect(loggerMock.error).toHaveBeenCalledWith(
			'Failed to schedule history archive objects',
			{
				app: 'history-scan-coordinator',
				errorMessage: error.message
			}
		);
	});
});
