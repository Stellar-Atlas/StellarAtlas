import { mock, MockProxy } from 'jest-mock-extended';
import { ScheduleScanJobs } from '../ScheduleScanJobs.js';
import type { ScanRepository } from '../../../domain/scan/ScanRepository.js';
import type { ScanJobRepository } from '../../../domain/ScanJobRepository.js';
import type { ScanScheduler } from '../../../domain/ScanScheduler.js';
import type { Logger } from 'logger';
import { ScanJob } from '../../../domain/ScanJob.js';

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

		scheduleScanJobs = new ScheduleScanJobs(
			scanRepositoryMock,
			scanJobRepositoryMock,
			scanSchedulerMock,
			loggerMock
		);
	});

	it('should do nothing if queue is not empty', async () => {
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
});
