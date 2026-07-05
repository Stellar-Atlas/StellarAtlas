import { mock, MockProxy } from 'jest-mock-extended';
import type { ScanJobRepository } from '@history-scan-coordinator/domain/ScanJobRepository.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { TouchScanJob } from '../TouchScanJob.js';

describe('TouchScanJob', () => {
	let touchScanJob: TouchScanJob;
	let scanJobRepositoryMock: MockProxy<ScanJobRepository>;
	let exceptionLoggerMock: MockProxy<ExceptionLogger>;

	beforeEach(() => {
		scanJobRepositoryMock = mock<ScanJobRepository>();
		exceptionLoggerMock = mock<ExceptionLogger>();
		touchScanJob = new TouchScanJob(scanJobRepositoryMock, exceptionLoggerMock);
	});

	it('should touch internal worker jobs without scanner ownership', async () => {
		scanJobRepositoryMock.markTakenJobActive.mockResolvedValue(true);

		const result = await touchScanJob.execute(
			'164f7788-9edb-4bb5-81c1-b928d85a21a5'
		);

		expect(result._unsafeUnwrap()).toBe(true);
		expect(scanJobRepositoryMock.markTakenJobActive).toHaveBeenCalledWith(
			'164f7788-9edb-4bb5-81c1-b928d85a21a5',
			undefined
		);
	});

	it('should pass progress for internal worker jobs', async () => {
		scanJobRepositoryMock.markTakenJobActive.mockResolvedValue(true);

		const progress = {
			concurrency: 12,
			fromLedger: 64,
			toLedger: 128,
			latestScannedLedger: 63,
			latestScannedLedgerHeaderHash: 'hash'
		};
		const result = await touchScanJob.execute(
			'164f7788-9edb-4bb5-81c1-b928d85a21a5',
			undefined,
			progress
		);

		expect(result._unsafeUnwrap()).toBe(true);
		expect(scanJobRepositoryMock.markTakenJobActive).toHaveBeenCalledWith(
			'164f7788-9edb-4bb5-81c1-b928d85a21a5',
			progress
		);
	});

	it('should touch community scanner jobs only through scanner ownership', async () => {
		scanJobRepositoryMock.markTakenJobActiveForCommunityScanner.mockResolvedValue(
			true
		);

		const result = await touchScanJob.execute(
			'164f7788-9edb-4bb5-81c1-b928d85a21a5',
			{ communityScannerId: '52ed19dc-d8cc-43d5-a337-675eae42876b' }
		);

		expect(result._unsafeUnwrap()).toBe(true);
		expect(
			scanJobRepositoryMock.markTakenJobActiveForCommunityScanner
		).toHaveBeenCalledWith(
			'164f7788-9edb-4bb5-81c1-b928d85a21a5',
			'52ed19dc-d8cc-43d5-a337-675eae42876b',
			undefined
		);
		expect(scanJobRepositoryMock.markTakenJobActive).not.toHaveBeenCalled();
	});
});
