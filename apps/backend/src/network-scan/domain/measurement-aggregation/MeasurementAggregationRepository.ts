import { MeasurementAggregation } from './MeasurementAggregation.js';
import { MeasurementAggregationSourceId } from './MeasurementAggregationSourceId.js';

export interface MeasurementAggregationRepository<
	T extends MeasurementAggregation
> {
	rollup(fromNetworkScanId: number, toNetworkScanId: number): Promise<void>;
	findBetween(
		id: MeasurementAggregationSourceId,
		from: Date,
		to: Date
	): Promise<T[]>;
}
