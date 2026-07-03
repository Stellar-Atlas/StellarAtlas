import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type NetworkMeasurementDay from '@network-scan/domain/network/NetworkMeasurementDay.js';
import type { NetworkMeasurementDayRepository } from '@network-scan/domain/network/NetworkMeasurementDayRepository.js';
import { NetworkId } from '@network-scan/domain/network/NetworkId.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import type {
	FbasTopTierHistoryDTO,
	FbasTopTierHistoryMetricDTO,
	FbasTopTierHistoryPointDTO
} from '../../domain/TopTierHistoryDTO.js';

export interface GetTopTierHistoryDTO {
	readonly from: Date;
	readonly to: Date;
}

export class FbasTopTierHistoryValidationError extends Error {}

const millisecondsPerDay = 24 * 60 * 60 * 1000;

@injectable()
export class GetTopTierHistory {
	static readonly maxWindowDays = 90;

	constructor(
		@inject(NETWORK_TYPES.NetworkMeasurementDayRepository)
		private readonly networkMeasurementDayRepository: NetworkMeasurementDayRepository,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		dto: GetTopTierHistoryDTO
	): Promise<Result<FbasTopTierHistoryDTO, Error>> {
		const rangeError = validateRange(dto);
		if (rangeError) return err(rangeError);

		try {
			const points = await this.networkMeasurementDayRepository.findBetween(
				new NetworkId('public'),
				truncateToUtcDay(dto.from),
				truncateToUtcDay(dto.to)
			);

			return ok({
				dayCount: points.length,
				evidenceSelection: 'network_measurement_day_rollups',
				from: toDayString(dto.from),
				generatedAt: new Date().toISOString(),
				maxWindowDays: GetTopTierHistory.maxWindowDays,
				points: points.map(mapPoint),
				proofSetPersistence: 'not_persisted',
				to: toDayString(dto.to)
			});
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.exceptionLogger.captureException(mappedError);
			return err(mappedError);
		}
	}
}

function validateRange(
	dto: GetTopTierHistoryDTO
): FbasTopTierHistoryValidationError | null {
	const fromDay = truncateToUtcDay(dto.from);
	const toDay = truncateToUtcDay(dto.to);
	if (fromDay.getTime() > toDay.getTime()) {
		return new FbasTopTierHistoryValidationError(
			'FBAS top-tier history from date must be before or equal to to date'
		);
	}

	if (getInclusiveDayCount(fromDay, toDay) > GetTopTierHistory.maxWindowDays) {
		return new FbasTopTierHistoryValidationError(
			`FBAS top-tier history window cannot exceed ${GetTopTierHistory.maxWindowDays} days`
		);
	}

	return null;
}

function mapPoint(
	measurement: NetworkMeasurementDay
): FbasTopTierHistoryPointDTO {
	return {
		crawlCount: measurement.crawlCount,
		day: toDayString(measurement.time),
		hasData: measurement.crawlCount > 0,
		hasQuorumIntersectionCount: measurement.hasQuorumIntersectionCount,
		hasSymmetricTopTierCount: measurement.hasSymmetricTopTierCount,
		hasTransitiveQuorumSetCount: measurement.hasTransitiveQuorumSetCount,
		topTier: mapMetric(
			measurement.topTierMin,
			measurement.topTierMax,
			measurement.topTierSum,
			measurement.crawlCount
		),
		topTierOrganizations: mapMetric(
			measurement.topTierOrgsMin,
			measurement.topTierOrgsMax,
			measurement.topTierOrgsSum,
			measurement.crawlCount
		)
	};
}

function mapMetric(
	min: number,
	max: number,
	sum: number,
	count: number
): FbasTopTierHistoryMetricDTO {
	return {
		average: count > 0 ? sum / count : null,
		max,
		min
	};
}

function getInclusiveDayCount(from: Date, to: Date): number {
	return Math.floor((to.getTime() - from.getTime()) / millisecondsPerDay) + 1;
}

function toDayString(value: Date): string {
	return truncateToUtcDay(value).toISOString().slice(0, 10);
}

function truncateToUtcDay(value: Date): Date {
	return new Date(
		Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
	);
}
