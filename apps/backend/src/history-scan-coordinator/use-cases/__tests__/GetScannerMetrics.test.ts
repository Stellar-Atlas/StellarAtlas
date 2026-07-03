import { mock, MockProxy } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { GetScannerMetrics } from '../GetScannerMetrics.js';
import {
	CommunityScanner,
	ScannerStatus
} from '../../infrastructure/database/entities/CommunityScanner.js';
import { Repository, SelectQueryBuilder } from 'typeorm';

describe('GetScannerMetrics', () => {
	let useCase: GetScannerMetrics;
	let scannerRepositoryMock: MockProxy<Repository<CommunityScanner>>;
	let exceptionLoggerMock: MockProxy<ExceptionLogger>;
	let queryBuilderMock: MockProxy<SelectQueryBuilder<CommunityScanner>>;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		scannerRepositoryMock = mock<Repository<CommunityScanner>>();
		exceptionLoggerMock = mock<ExceptionLogger>();
		queryBuilderMock = mock<SelectQueryBuilder<CommunityScanner>>();
		queryBuilderMock.select.mockReturnThis();
		queryBuilderMock.setParameters.mockReturnThis();
		scannerRepositoryMock.createQueryBuilder.mockReturnValue(queryBuilderMock);
		useCase = new GetScannerMetrics(scannerRepositoryMock, exceptionLoggerMock);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should return heartbeat-derived scanner metrics', async () => {
		queryBuilderMock.getRawOne.mockResolvedValue({
			totalScanners: '10',
			activeScanners: '6',
			offlineScanners: '4',
			degradedScanners: '1',
			pendingScanners: '1',
			blacklistedScanners: '2',
			avgSuccessRate: '85.50',
			totalCompleted: '1250',
			totalFailed: '150',
			avgCompletionTime: '15000'
		});

		const result = await useCase.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			generatedAt: '2026-07-03T12:00:00.000Z',
			heartbeatFreshnessMs: 300000,
			totalScanners: 10,
			activeScanners: 6,
			offlineScanners: 4,
			degradedScanners: 1,
			pendingScanners: 1,
			blacklistedScanners: 2,
			averageSuccessRate: 85.5,
			totalJobsCompleted: 1250,
			totalJobsFailed: 150,
			averageCompletionTimeMs: 15000
		});
		expect(scannerRepositoryMock.createQueryBuilder).toHaveBeenCalledWith(
			'scanner'
		);
		expect(queryBuilderMock.select.mock.calls[0]?.[0]).toEqual(
			expect.arrayContaining([
				expect.stringContaining('scanner.blacklistedUntil <= :generatedAt'),
				expect.stringContaining('scanner.blacklistedUntil > :generatedAt')
			])
		);
		expect(queryBuilderMock.setParameters).toHaveBeenCalledWith({
			generatedAt: new Date('2026-07-03T12:00:00.000Z'),
			heartbeatCutoff: new Date('2026-07-03T11:55:00.000Z'),
			degradedStatus: ScannerStatus.DEGRADED,
			pendingStatus: ScannerStatus.PENDING
		});
	});

	it('should handle null aggregate values as zeros', async () => {
		queryBuilderMock.getRawOne.mockResolvedValue({
			totalScanners: '0',
			activeScanners: '0',
			offlineScanners: '0',
			degradedScanners: '0',
			pendingScanners: '0',
			blacklistedScanners: '0',
			avgSuccessRate: null,
			totalCompleted: null,
			totalFailed: null,
			avgCompletionTime: null
		});

		const result = await useCase.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			totalScanners: 0,
			activeScanners: 0,
			averageSuccessRate: 0,
			totalJobsCompleted: 0,
			totalJobsFailed: 0,
			averageCompletionTimeMs: 0
		});
	});

	it('should log and return query errors', async () => {
		const error = new Error('aggregate query failed');
		queryBuilderMock.getRawOne.mockRejectedValue(error);

		const result = await useCase.execute();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
		expect(exceptionLoggerMock.captureException).toHaveBeenCalledWith(error);
	});
});
