import { mock, MockProxy } from 'jest-mock-extended';
import type { Config } from '@core/config/Config.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import { GetScanStatus } from '../GetScanStatus.js';

describe('GetScanStatus', () => {
	let networkScanRepositoryMock: MockProxy<NetworkScanRepository>;
	let exceptionLoggerMock: MockProxy<ExceptionLogger>;
	let configMock: MockProxy<Config>;
	let getScanStatus: GetScanStatus;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		networkScanRepositoryMock = mock<NetworkScanRepository>();
		exceptionLoggerMock = mock<ExceptionLogger>();
		configMock = mock<Config>();
		configMock.networkScanLoopIntervalMs = 3 * 60 * 1000;
		getScanStatus = new GetScanStatus(
			networkScanRepositoryMock,
			configMock,
			exceptionLoggerMock
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should expose raw network scan continuity for the last 24 hours', async () => {
		networkScanRepositoryMock.findScanSummary.mockResolvedValue({
			totalScans: 480,
			completedScans: 479,
			latestScanAt: new Date('2026-07-03T11:59:00.000Z'),
			latestCompletedScanAt: new Date('2026-07-03T11:56:00.000Z')
		});

		const result = await getScanStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			generatedAt: '2026-07-03T12:00:00.000Z',
			status: 'ok',
			networkScan: {
				status: 'ok',
				windowStart: '2026-07-02T12:00:00.000Z',
				windowEnd: '2026-07-03T12:00:00.000Z',
				windowMs: 24 * 60 * 60 * 1000,
				scanIntervalMs: 3 * 60 * 1000,
				expectedScans: 480,
				totalScans: 480,
				completedScans: 479,
				incompleteScans: 1,
				completionRate: 99.79,
				expectedCompletionRate: 99.79,
				latestScanAt: '2026-07-03T11:59:00.000Z',
				latestCompletedScanAt: '2026-07-03T11:56:00.000Z'
			}
		});
		expect(networkScanRepositoryMock.findScanSummary).toHaveBeenCalledWith(
			new Date('2026-07-02T12:00:00.000Z'),
			new Date('2026-07-03T12:00:00.000Z')
		);
	});

	it('should degrade when recorded scan completion is low', async () => {
		networkScanRepositoryMock.findScanSummary.mockResolvedValue({
			totalScans: 100,
			completedScans: 90,
			latestScanAt: new Date('2026-07-03T11:59:00.000Z'),
			latestCompletedScanAt: new Date('2026-07-03T11:56:00.000Z')
		});

		const result = await getScanStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().status).toBe('degraded');
		expect(result._unsafeUnwrap().networkScan).toMatchObject({
			status: 'degraded',
			incompleteScans: 10,
			completionRate: 90
		});
	});

	it('should keep cadence shortfall informational when recorded scans complete', async () => {
		networkScanRepositoryMock.findScanSummary.mockResolvedValue({
			totalScans: 375,
			completedScans: 375,
			latestScanAt: new Date('2026-07-03T11:59:00.000Z'),
			latestCompletedScanAt: new Date('2026-07-03T11:59:00.000Z')
		});

		const result = await getScanStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().networkScan).toMatchObject({
			status: 'ok',
			completionRate: 100,
			expectedScans: 480,
			expectedCompletionRate: 78.13
		});
	});

	it('should mark missing raw scan data unavailable', async () => {
		networkScanRepositoryMock.findScanSummary.mockResolvedValue({
			totalScans: 0,
			completedScans: 0,
			latestScanAt: null,
			latestCompletedScanAt: null
		});

		const result = await getScanStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			status: 'unavailable',
			networkScan: {
				status: 'unavailable',
				totalScans: 0,
				completedScans: 0,
				completionRate: null,
				latestScanAt: null,
				latestCompletedScanAt: null
			}
		});
	});

	it('should log and return repository errors', async () => {
		const error = new Error('database unavailable');
		networkScanRepositoryMock.findScanSummary.mockRejectedValue(error);

		const result = await getScanStatus.execute();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
		expect(exceptionLoggerMock.captureException).toHaveBeenCalledWith(error);
	});
});
