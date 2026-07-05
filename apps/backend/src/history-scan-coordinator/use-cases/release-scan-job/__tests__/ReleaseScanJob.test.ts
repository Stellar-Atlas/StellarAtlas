import { mock, MockProxy } from 'jest-mock-extended';
import type { ScanJobRepository } from '@history-scan-coordinator/domain/ScanJobRepository.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { ReleaseScanJob } from '../ReleaseScanJob.js';

describe('ReleaseScanJob', () => {
	let releaseScanJob: ReleaseScanJob;
	let scanJobRepositoryMock: MockProxy<ScanJobRepository>;
	let exceptionLoggerMock: MockProxy<ExceptionLogger>;

	beforeEach(() => {
		scanJobRepositoryMock = mock<ScanJobRepository>();
		exceptionLoggerMock = mock<ExceptionLogger>();
		releaseScanJob = new ReleaseScanJob(
			scanJobRepositoryMock,
			exceptionLoggerMock
		);
	});

	it('should release an internal taken scan job', async () => {
		scanJobRepositoryMock.releaseTakenJob.mockResolvedValue(true);

		const result = await releaseScanJob.execute(
			'164f7788-9edb-4bb5-81c1-b928d85a21a5'
		);

		expect(result._unsafeUnwrap()).toBe(true);
		expect(scanJobRepositoryMock.releaseTakenJob).toHaveBeenCalledWith(
			'164f7788-9edb-4bb5-81c1-b928d85a21a5'
		);
	});
});
