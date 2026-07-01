import type { MeasurementAggregationRepository } from '../measurement-aggregation/MeasurementAggregationRepository.js';
import NetworkMeasurementDay from './NetworkMeasurementDay.js';
import { NetworkMeasurementAggregation } from './NetworkMeasurementAggregation.js';
import { NetworkId } from './NetworkId.js';

export interface NetworkMeasurementDayRepository extends MeasurementAggregationRepository<NetworkMeasurementAggregation> {
	findBetween(
		id: NetworkId,
		from: Date,
		to: Date
	): Promise<NetworkMeasurementDay[]>;
}
