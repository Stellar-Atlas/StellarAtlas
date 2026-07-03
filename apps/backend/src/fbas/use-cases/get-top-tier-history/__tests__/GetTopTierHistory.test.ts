import { mock, MockProxy } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import NetworkMeasurementDay from '@network-scan/domain/network/NetworkMeasurementDay.js';
import type { NetworkMeasurementDayRepository } from '@network-scan/domain/network/NetworkMeasurementDayRepository.js';
import { GetTopTierHistory } from '../GetTopTierHistory.js';

describe('GetTopTierHistory', () => {
	let networkMeasurementDayRepository: MockProxy<NetworkMeasurementDayRepository>;
	let exceptionLogger: MockProxy<ExceptionLogger>;
	let getTopTierHistory: GetTopTierHistory;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		networkMeasurementDayRepository = mock<NetworkMeasurementDayRepository>();
		exceptionLogger = mock<ExceptionLogger>();
		getTopTierHistory = new GetTopTierHistory(
			networkMeasurementDayRepository,
			exceptionLogger
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should expose aggregate top-tier history from daily network rollups', async () => {
		networkMeasurementDayRepository.findBetween.mockResolvedValue([
			makeMeasurementDay('2026-07-01', {
				crawlCount: 4,
				hasQuorumIntersectionCount: 3,
				hasSymmetricTopTierCount: 2,
				hasTransitiveQuorumSetCount: 4,
				topTierMax: 12,
				topTierMin: 8,
				topTierOrgsMax: 5,
				topTierOrgsMin: 3,
				topTierOrgsSum: 16,
				topTierSum: 40
			}),
			makeMeasurementDay('2026-07-02', {
				crawlCount: 0
			})
		]);

		const result = await getTopTierHistory.execute({
			from: new Date('2026-07-01T08:30:00.000Z'),
			to: new Date('2026-07-02T23:59:59.000Z')
		});

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			dayCount: 2,
			evidenceSelection: 'network_measurement_day_rollups',
			from: '2026-07-01',
			generatedAt: '2026-07-03T12:00:00.000Z',
			maxWindowDays: 90,
			proofSetPersistence: 'not_persisted',
			to: '2026-07-02',
			points: [
				{
					crawlCount: 4,
					day: '2026-07-01',
					hasData: true,
					hasQuorumIntersectionCount: 3,
					hasSymmetricTopTierCount: 2,
					hasTransitiveQuorumSetCount: 4,
					topTier: {
						average: 10,
						max: 12,
						min: 8
					},
					topTierOrganizations: {
						average: 4,
						max: 5,
						min: 3
					}
				},
				{
					crawlCount: 0,
					day: '2026-07-02',
					hasData: false,
					hasQuorumIntersectionCount: 0,
					hasSymmetricTopTierCount: 0,
					hasTransitiveQuorumSetCount: 0,
					topTier: {
						average: null,
						max: 0,
						min: 0
					},
					topTierOrganizations: {
						average: null,
						max: 0,
						min: 0
					}
				}
			]
		});
		expect(networkMeasurementDayRepository.findBetween).toHaveBeenCalledWith(
			expect.objectContaining({ value: 'public' }),
			new Date('2026-07-01T00:00:00.000Z'),
			new Date('2026-07-02T00:00:00.000Z')
		);
	});

	it('should reject windows where from is after to', async () => {
		const result = await getTopTierHistory.execute({
			from: new Date('2026-07-02T00:00:00.000Z'),
			to: new Date('2026-07-01T00:00:00.000Z')
		});

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().message).toBe(
			'FBAS top-tier history from date must be before or equal to to date'
		);
		expect(networkMeasurementDayRepository.findBetween).not.toHaveBeenCalled();
		expect(exceptionLogger.captureException).not.toHaveBeenCalled();
	});

	it('should reject windows larger than the maximum', async () => {
		const result = await getTopTierHistory.execute({
			from: new Date('2026-01-01T00:00:00.000Z'),
			to: new Date('2026-04-02T00:00:00.000Z')
		});

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().message).toBe(
			'FBAS top-tier history window cannot exceed 90 days'
		);
		expect(networkMeasurementDayRepository.findBetween).not.toHaveBeenCalled();
		expect(exceptionLogger.captureException).not.toHaveBeenCalled();
	});

	it('should log and return repository errors', async () => {
		const error = new Error('rollup repository unavailable');
		networkMeasurementDayRepository.findBetween.mockRejectedValue(error);

		const result = await getTopTierHistory.execute({
			from: new Date('2026-07-01T00:00:00.000Z'),
			to: new Date('2026-07-01T00:00:00.000Z')
		});

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
		expect(exceptionLogger.captureException).toHaveBeenCalledWith(error);
	});
});

function makeMeasurementDay(
	day: string,
	overrides: Partial<NetworkMeasurementDay>
): NetworkMeasurementDay {
	const measurement = new NetworkMeasurementDay();
	measurement.time = new Date(`${day}T00:00:00.000Z`);
	Object.assign(measurement, overrides);
	return measurement;
}
