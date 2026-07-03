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
		queryBuilderMock.leftJoin.mockReturnThis();
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
			permanentlyBlacklistedScanners: '1',
			temporarilyBlockedScanners: '1',
			claimDeniedByBlockedScanners: '2',
			claimDeniedByActiveJobLimitScanners: '3',
			claimDeniedByProductionScoreScanners: '1',
			claimIneligibleScanners: '6',
			probationaryScanners: '2',
			claimEligibleScanners: '4',
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
			permanentlyBlacklistedScanners: 1,
			temporarilyBlockedScanners: 1,
			claimDeniedByBlockedScanners: 2,
			claimDeniedByActiveJobLimitScanners: 3,
			claimDeniedByProductionScoreScanners: 1,
			claimIneligibleScanners: 6,
			probationaryScanners: 2,
			claimEligibleScanners: 4,
			claimPolicyMaxActiveJobsPerScanner: 1,
			claimPolicyMinJobsForProductionScore: 5,
			claimPolicyMinSuccessRate: 50,
			staleScanJobAgeMs: 1800000,
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
				expect.stringContaining(
					'"scanner"."blacklisted_until" <= :generatedAt'
				),
				expect.stringContaining(
					'"scanner"."blacklisted_until" > :generatedAt'
				),
				expect.stringContaining(
					'claimDeniedByActiveJobLimitScanners'
				),
				expect.stringContaining(
					'claimDeniedByProductionScoreScanners'
				),
				expect.stringContaining('claimIneligibleScanners')
			])
		);
		const joinFactory = queryBuilderMock.leftJoin.mock.calls[0]?.[0];
		const subQueryMock = {
			select: jest.fn().mockReturnThis(),
			addSelect: jest.fn().mockReturnThis(),
			from: jest.fn().mockReturnThis(),
			where: jest.fn().mockReturnThis(),
			andWhere: jest.fn().mockReturnThis(),
			groupBy: jest.fn().mockReturnThis()
		};
		if (typeof joinFactory !== 'function') {
			throw new Error('Expected active-job join factory');
		}
		joinFactory(subQueryMock as never);
		expect(subQueryMock.andWhere).toHaveBeenCalledWith(
			'job."claimedByCommunityScannerId" is not null'
		);
		expect(queryBuilderMock.leftJoin).toHaveBeenCalledWith(
			expect.any(Function),
			'active_job_counts',
			'active_job_counts."communityScannerId" = scanner.id'
		);
		expect(queryBuilderMock.setParameters).toHaveBeenCalledWith({
			generatedAt: new Date('2026-07-03T12:00:00.000Z'),
			heartbeatCutoff: new Date('2026-07-03T11:55:00.000Z'),
			staleTakenBefore: new Date('2026-07-03T11:30:00.000Z'),
			maxActiveJobsPerScanner: 1,
			minJobsForProductionScore: 5,
			minSuccessRate: 50,
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
			permanentlyBlacklistedScanners: '0',
			temporarilyBlockedScanners: '0',
			claimDeniedByBlockedScanners: '0',
			claimDeniedByActiveJobLimitScanners: '0',
			claimDeniedByProductionScoreScanners: '0',
			claimIneligibleScanners: '0',
			probationaryScanners: '0',
			claimEligibleScanners: '0',
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
