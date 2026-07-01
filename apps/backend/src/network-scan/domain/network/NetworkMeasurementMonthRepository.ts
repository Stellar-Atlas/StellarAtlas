import type { MeasurementAggregationRepository } from '../measurement-aggregation/MeasurementAggregationRepository.js';
import NetworkMeasurementMonth from './NetworkMeasurementMonth.js';
import { NetworkId } from './NetworkId.js';

export interface NetworkMeasurementMonthRepository extends MeasurementAggregationRepository<NetworkMeasurementMonth> {
	findBetween(
		networkId: NetworkId,
		from: Date,
		to: Date
	): Promise<NetworkMeasurementMonth[]>;

	rollup(fromCrawlId: number, toCrawlId: number): Promise<void>;
}
