import { mock, MockProxy } from 'jest-mock-extended';
import { GetScanJob } from '../GetScanJob.js';
import type { ScanJobRepository } from '../../../domain/ScanJobRepository.js';
import type { ExceptionLogger } from '../../../../core/services/ExceptionLogger.js';
import type { Logger } from 'logger';
import { ok } from 'neverthrow';
import { ScanJob } from '../../../domain/ScanJob.js';

describe('GetScanJob', () => {
	let getScanJob: GetScanJob;
	let scanJobRepositoryMock: MockProxy<ScanJobRepository>;
	let exceptionLoggerMock: MockProxy<ExceptionLogger>;
	let loggerMock: MockProxy<Logger>;

	beforeEach(() => {
		scanJobRepositoryMock = mock<ScanJobRepository>();
		exceptionLoggerMock = mock<ExceptionLogger>();
		loggerMock = mock<Logger>();

		getScanJob = new GetScanJob(
			scanJobRepositoryMock,
			exceptionLoggerMock,
			loggerMock
		);
	});

	it('should return ok(null) when no scan job is available', async () => {
		scanJobRepositoryMock.releaseStaleTakenJobs.mockResolvedValue(0);
		scanJobRepositoryMock.fetchNextJob.mockResolvedValue(null);
		const result = await getScanJob.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toBeNull();
		expect(loggerMock.info).toHaveBeenCalledWith('No scan jobs available', {
			app: 'history-scan-coordinator'
		});
		expect(scanJobRepositoryMock.releaseStaleTakenJobs).toHaveBeenCalledTimes(
			1
		);
	});

	it('should return ok(job) when a scan job is available and update its status to TAKEN', async () => {
		const mockJob = new ScanJob('http://test.com');
		scanJobRepositoryMock.releaseStaleTakenJobs.mockResolvedValue(0);
		scanJobRepositoryMock.fetchNextJob.mockResolvedValue(mockJob);

		const result = await getScanJob.execute();

		expect(result).toEqual(
			ok({
				chainInitDate: mockJob.chainInitDate,
				url: mockJob.url,
				latestScannedLedger: mockJob.latestScannedLedger,
				latestScannedLedgerHeaderHash: mockJob.latestScannedLedgerHeaderHash,
				remoteId: mockJob.remoteId,
				fromLedger: mockJob.fromLedger,
				toLedger: mockJob.toLedger,
				concurrency: mockJob.concurrency
			})
		);
		expect(loggerMock.info).toHaveBeenCalledWith('Returning next scan job', {
			app: 'history-scan-coordinator',
			url: 'http://test.com',
			chainInitDate: mockJob.chainInitDate
		});

		expect(scanJobRepositoryMock.save).toHaveBeenCalledWith([
			{
				...mockJob,
				status: 'TAKEN'
			}
		]);
	});

	it('should return err(error) when fetchNextJob fails', async () => {
		const error = new Error('Database error');
		scanJobRepositoryMock.releaseStaleTakenJobs.mockResolvedValue(0);
		scanJobRepositoryMock.fetchNextJob.mockRejectedValueOnce(error);

		const result = await getScanJob.execute();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toEqual(error);
		expect(exceptionLoggerMock.captureException).toHaveBeenCalledWith(error);
	});

	it('should release stale taken jobs before fetching the next job', async () => {
		scanJobRepositoryMock.releaseStaleTakenJobs.mockResolvedValue(2);
		scanJobRepositoryMock.fetchNextJob.mockResolvedValue(null);

		const result = await getScanJob.execute();

		expect(result.isOk()).toBe(true);
		expect(scanJobRepositoryMock.releaseStaleTakenJobs).toHaveBeenCalledTimes(
			1
		);
		expect(loggerMock.info).toHaveBeenCalledWith('Released stale scan jobs', {
			app: 'history-scan-coordinator',
			released: 2
		});
	});
});
