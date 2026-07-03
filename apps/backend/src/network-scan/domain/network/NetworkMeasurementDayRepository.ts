import type { MeasurementAggregationRepository } from '../measurement-aggregation/MeasurementAggregationRepository.js';
import NetworkMeasurementDay from './NetworkMeasurementDay.js';
import { NetworkMeasurementAggregation } from './NetworkMeasurementAggregation.js';
import { NetworkId } from './NetworkId.js';

export interface NetworkScanRollupDaySummary {
	readonly day: Date;
	readonly rawCompletedScans: number;
	readonly rollupCrawlCount: number | null;
}

export interface NetworkMeasurementDayRepository extends MeasurementAggregationRepository<NetworkMeasurementAggregation> {
	findBetween(
		id: NetworkId,
		from: Date,
		to: Date
	): Promise<NetworkMeasurementDay[]>;

	findScanRollupSummary(
		from: Date,
		to: Date
	): Promise<NetworkScanRollupDaySummary[]>;
}
