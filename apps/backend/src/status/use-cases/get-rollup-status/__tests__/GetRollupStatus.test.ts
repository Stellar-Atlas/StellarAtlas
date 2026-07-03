import { mock, MockProxy } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import type { NetworkMeasurementDayRepository } from '@network-scan/domain/network/NetworkMeasurementDayRepository.js';
import { GetRollupStatus } from '../GetRollupStatus.js';

describe('GetRollupStatus', () => {
	let networkMeasurementDayRepositoryMock: MockProxy<NetworkMeasurementDayRepository>;
	let exceptionLoggerMock: MockProxy<ExceptionLogger>;
	let getRollupStatus: GetRollupStatus;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		networkMeasurementDayRepositoryMock =
			mock<NetworkMeasurementDayRepository>();
		exceptionLoggerMock = mock<ExceptionLogger>();
		getRollupStatus = new GetRollupStatus(
			networkMeasurementDayRepositoryMock,
			exceptionLoggerMock
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should expose matching raw scan and rollup continuity', async () => {
		networkMeasurementDayRepositoryMock.findScanRollupSummary.mockResolvedValue(
			createMatchingSummaries()
		);

		const result = await getRollupStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			generatedAt: '2026-07-03T12:00:00.000Z',
			status: 'ok',
			networkRollups: {
				status: 'ok',
				windowStart: '2026-06-26T00:00:00.000Z',
				windowEnd: '2026-07-03T00:00:00.000Z',
				windowDays: 7,
				rawCompletedScans: 70,
				rollupCrawlCount: 70,
				daysWithCompletedScans: 7,
				daysWithRollups: 7,
				matchingDays: 7,
				missingRollupDays: 0,
				mismatchedRollupDays: 0,
				latestRollupDay: '2026-07-02T00:00:00.000Z',
				days: createMatchingSummaries().map((summary) => ({
					day: summary.day.toISOString(),
					status: 'ok',
					rawCompletedScans: 10,
					rollupCrawlCount: 10,
					hasRollup: true,
					matchesRawCompletedScans: true
				}))
			}
		});
		expect(
			networkMeasurementDayRepositoryMock.findScanRollupSummary
		).toHaveBeenCalledWith(
			new Date('2026-06-26T00:00:00.000Z'),
			new Date('2026-07-03T00:00:00.000Z')
		);
	});

	it('should degrade when a raw scan day has no rollup row', async () => {
		networkMeasurementDayRepositoryMock.findScanRollupSummary.mockResolvedValue(
			[
				{
					day: new Date('2026-06-26T00:00:00.000Z'),
					rawCompletedScans: 10,
					rollupCrawlCount: null
				}
			]
		);

		const result = await getRollupStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().networkRollups).toMatchObject({
			status: 'degraded',
			rawCompletedScans: 10,
			rollupCrawlCount: 0,
			missingRollupDays: 1,
			mismatchedRollupDays: 0
		});
	});

	it('should degrade when rollup crawl counts do not match raw scans', async () => {
		networkMeasurementDayRepositoryMock.findScanRollupSummary.mockResolvedValue(
			[
				{
					day: new Date('2026-06-26T00:00:00.000Z'),
					rawCompletedScans: 10,
					rollupCrawlCount: 9
				}
			]
		);

		const result = await getRollupStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().networkRollups).toMatchObject({
			status: 'degraded',
			rawCompletedScans: 10,
			rollupCrawlCount: 9,
			missingRollupDays: 0,
			mismatchedRollupDays: 1
		});
	});

	it('should mark missing raw and rollup data unavailable', async () => {
		networkMeasurementDayRepositoryMock.findScanRollupSummary.mockResolvedValue(
			[
				{
					day: new Date('2026-06-26T00:00:00.000Z'),
					rawCompletedScans: 0,
					rollupCrawlCount: null
				}
			]
		);

		const result = await getRollupStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			status: 'unavailable',
			networkRollups: {
				status: 'unavailable',
				rawCompletedScans: 0,
				rollupCrawlCount: 0,
				latestRollupDay: null
			}
		});
	});

	it('should log and return repository errors', async () => {
		const error = new Error('database unavailable');
		networkMeasurementDayRepositoryMock.findScanRollupSummary.mockRejectedValue(
			error
		);

		const result = await getRollupStatus.execute();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
		expect(exceptionLoggerMock.captureException).toHaveBeenCalledWith(error);
	});
});

function createMatchingSummaries() {
	return Array.from({ length: 7 }, (_, index) => ({
		day: new Date(Date.UTC(2026, 5, 26 + index)),
		rawCompletedScans: 10,
		rollupCrawlCount: 10
	}));
}
