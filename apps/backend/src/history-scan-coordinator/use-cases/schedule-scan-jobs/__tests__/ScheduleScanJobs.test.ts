import { mock, MockProxy } from 'jest-mock-extended';
import { ScheduleScanJobs } from '../ScheduleScanJobs.js';
import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import type { ScanJobRepository } from '@history-scan-coordinator/domain/ScanJobRepository.js';
import type { ScanScheduler } from '@history-scan-coordinator/domain/ScanScheduler.js';
import type { Logger } from 'logger';
import { ScanJob } from '@history-scan-coordinator/domain/ScanJob.js';

describe('ScheduleScanJobs', () => {
	let scheduleScanJobs: ScheduleScanJobs;
	let scanRepositoryMock: MockProxy<ScanRepository>;
	let scanJobRepositoryMock: MockProxy<ScanJobRepository>;
	let scanSchedulerMock: MockProxy<ScanScheduler>;
	let loggerMock: MockProxy<Logger>;

	beforeEach(() => {
		scanRepositoryMock = mock<ScanRepository>();
		scanJobRepositoryMock = mock<ScanJobRepository>();
		scanSchedulerMock = mock<ScanScheduler>();
		loggerMock = mock<Logger>();
		scanJobRepositoryMock.withSchedulingLock.mockImplementation(async (work) =>
			work()
		);

		scheduleScanJobs = new ScheduleScanJobs(
			scanRepositoryMock,
			scanJobRepositoryMock,
			scanSchedulerMock,
			loggerMock
		);
	});

	it('should do nothing if queue is not empty', async () => {
		scanJobRepositoryMock.releaseStaleTakenJobs.mockResolvedValue(0);
		scanJobRepositoryMock.hasPendingJobs.mockResolvedValue(true);
		scanJobRepositoryMock.findUnfinishedJobs.mockResolvedValue([]);
		scanRepositoryMock.findLatest.mockResolvedValue([]);
		scanSchedulerMock.schedule.mockReturnValue([]);
		const result = await scheduleScanJobs.execute({
			historyArchiveUrls: ['https://example.com']
		});
		expect(result.isOk()).toBe(true);
		expect(scanRepositoryMock.findLatest).toHaveBeenCalledTimes(1);
		expect(scanSchedulerMock.schedule).toHaveBeenCalledWith(
			['https://example.com'],
			[],
			[],
			{ includeRegularJobs: false }
		);
		expect(scanJobRepositoryMock.save).not.toHaveBeenCalled();
	});

	it('should schedule jobs if queue is empty', async () => {
		scanJobRepositoryMock.releaseStaleTakenJobs.mockResolvedValue(0);
		scanJobRepositoryMock.hasPendingJobs.mockResolvedValue(false);
		scanJobRepositoryMock.findUnfinishedJobs.mockResolvedValue([]);
		scanRepositoryMock.findLatest.mockResolvedValue([]);
		scanSchedulerMock.schedule.mockReturnValue([
			new ScanJob('https://example.com')
		]);

		const result = await scheduleScanJobs.execute({
			historyArchiveUrls: ['https://example.com']
		});

		expect(result.isOk()).toBe(true);
		expect(scanRepositoryMock.findLatest).toHaveBeenCalledTimes(1);
		expect(scanSchedulerMock.schedule).toHaveBeenCalledWith(
			['https://example.com'],
			[],
			[],
			{ includeRegularJobs: true }
		);
		expect(scanJobRepositoryMock.save).toHaveBeenCalledTimes(1);
	});

	it('should save prioritized jobs even when regular jobs are pending', async () => {
		scanJobRepositoryMock.releaseStaleTakenJobs.mockResolvedValue(0);
		scanJobRepositoryMock.hasPendingJobs.mockResolvedValue(true);
		scanJobRepositoryMock.findUnfinishedJobs.mockResolvedValue([]);
		scanRepositoryMock.findLatest.mockResolvedValue([]);
		scanSchedulerMock.schedule.mockReturnValue([
			new ScanJob('https://example.com', 0, null, null, 0, 127, 4)
		]);

		const result = await scheduleScanJobs.execute({
			historyArchiveUrls: ['https://example.com']
		});

		expect(result.isOk()).toBe(true);
		expect(scanJobRepositoryMock.save).toHaveBeenCalledTimes(1);
	});

	it('should release stale taken jobs before checking queue state', async () => {
		scanJobRepositoryMock.releaseStaleTakenJobs.mockResolvedValue(3);
		scanJobRepositoryMock.hasPendingJobs.mockResolvedValue(false);
		scanJobRepositoryMock.findUnfinishedJobs.mockResolvedValue([]);
		scanRepositoryMock.findLatest.mockResolvedValue([]);
		scanSchedulerMock.schedule.mockReturnValue([]);

		const result = await scheduleScanJobs.execute({
			historyArchiveUrls: ['https://example.com']
		});

		expect(result.isOk()).toBe(true);
		expect(scanJobRepositoryMock.releaseStaleTakenJobs).toHaveBeenCalledTimes(
			1
		);
		expect(loggerMock.info).toHaveBeenCalledWith('Released stale scan jobs', {
			app: 'history-scan-coordinator',
			released: 3
		});
		expect(scanJobRepositoryMock.hasPendingJobs).toHaveBeenCalledTimes(1);
	});

	it('should run scheduling inside the scheduler lock', async () => {
		scanJobRepositoryMock.releaseStaleTakenJobs.mockResolvedValue(0);
		scanJobRepositoryMock.hasPendingJobs.mockResolvedValue(false);
		scanJobRepositoryMock.findUnfinishedJobs.mockResolvedValue([]);
		scanRepositoryMock.findLatest.mockResolvedValue([]);
		scanSchedulerMock.schedule.mockReturnValue([]);

		const result = await scheduleScanJobs.execute({
			historyArchiveUrls: ['https://example.com']
		});

		expect(result.isOk()).toBe(true);
		expect(scanJobRepositoryMock.withSchedulingLock).toHaveBeenCalledTimes(1);
	});

	it('should return an error when scheduler locking fails', async () => {
		const error = new Error('lock unavailable');
		scanJobRepositoryMock.withSchedulingLock.mockRejectedValue(error);

		const result = await scheduleScanJobs.execute({
			historyArchiveUrls: ['https://example.com']
		});

		expect(result.isErr()).toBe(true);
		expect(loggerMock.error).toHaveBeenCalledWith(
			'Failed to schedule scan jobs',
			{
				app: 'history-scan-coordinator',
				errorMessage: error.message
			}
		);
	});
});
