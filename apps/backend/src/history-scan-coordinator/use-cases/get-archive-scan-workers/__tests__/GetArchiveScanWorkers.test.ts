import { mock, MockProxy } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { ScanJob } from '@history-scan-coordinator/domain/ScanJob.js';
import type { ScanJobRepository } from '@history-scan-coordinator/domain/ScanJobRepository.js';
import { GetArchiveScanWorkers } from '../GetArchiveScanWorkers.js';

describe('GetArchiveScanWorkers', () => {
	let getArchiveScanWorkers: GetArchiveScanWorkers;
	let scanJobRepositoryMock: MockProxy<ScanJobRepository>;
	let exceptionLoggerMock: MockProxy<ExceptionLogger>;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		scanJobRepositoryMock = mock<ScanJobRepository>();
		exceptionLoggerMock = mock<ExceptionLogger>();
		getArchiveScanWorkers = new GetArchiveScanWorkers(
			scanJobRepositoryMock,
			exceptionLoggerMock
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should return safe public worker metadata for taken jobs', async () => {
		const activeJob = new ScanJob(
			'https://active.example',
			10,
			null,
			null,
			null,
			99,
			50
		);
		activeJob.status = 'TAKEN';
		activeJob.createdAt = new Date('2026-07-03T11:00:00.000Z');
		activeJob.claimedAt = new Date('2026-07-03T11:30:00.000Z');
		activeJob.updatedAt = new Date('2026-07-03T11:45:00.000Z');
		const staleJob = new ScanJob(
			'https://stale.example',
			0,
			null,
			null,
			0,
			null,
			2
		);
		staleJob.status = 'TAKEN';
		staleJob.createdAt = new Date('2026-07-03T10:00:00.000Z');
		staleJob.claimedAt = new Date('2026-07-03T10:30:00.000Z');
		staleJob.updatedAt = new Date('2026-07-03T11:00:00.000Z');
		scanJobRepositoryMock.getTakenJobsSnapshot.mockResolvedValue({
			activeTakenJobs: 1,
			staleTakenJobs: 1,
			totalTakenJobs: 2,
			jobs: [staleJob, activeJob]
		});

		const result = await getArchiveScanWorkers.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			generatedAt: '2026-07-03T12:00:00.000Z',
			staleJobAgeMs: 1800000,
			activeWorkers: 1,
			staleWorkers: 1,
			totalTakenJobs: 2,
			workers: [
				{
					archiveUrl: 'https://stale.example',
					status: 'stale',
					claimedAt: '2026-07-03T10:30:00.000Z',
					lastHeartbeatAt: '2026-07-03T11:00:00.000Z',
					heartbeatAgeMs: 3600000,
					fromLedger: 0,
					toLedger: null,
					latestScannedLedger: 0,
					concurrency: 2
				},
				{
					archiveUrl: 'https://active.example',
					status: 'scanning',
					claimedAt: '2026-07-03T11:30:00.000Z',
					lastHeartbeatAt: '2026-07-03T11:45:00.000Z',
					heartbeatAgeMs: 900000,
					fromLedger: 11,
					toLedger: 99,
					latestScannedLedger: 10,
					concurrency: 24
				}
			]
		});
		expect(scanJobRepositoryMock.getTakenJobsSnapshot).toHaveBeenCalledWith(
			new Date('2026-07-03T11:30:00.000Z'),
			50
		);
	});

	it('should log and return repository errors', async () => {
		const error = new Error('database unavailable');
		scanJobRepositoryMock.getTakenJobsSnapshot.mockRejectedValue(error);

		const result = await getArchiveScanWorkers.execute();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
		expect(exceptionLoggerMock.captureException).toHaveBeenCalledWith(error);
	});
});
