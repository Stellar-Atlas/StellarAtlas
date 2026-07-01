import { NodeMeasurementAverage } from './NodeMeasurementAverage.js';
import type { MeasurementAggregationRepository } from '../measurement-aggregation/MeasurementAggregationRepository.js';
import NodeMeasurementDay from './NodeMeasurementDay.js';
import PublicKey from './PublicKey.js';

export interface NodeMeasurementDayRepository extends MeasurementAggregationRepository<NodeMeasurementDay> {
	findXDaysAverageAt(
		at: Date,
		xDays: number
	): Promise<NodeMeasurementAverage[]>;

	findBetween(
		publicKey: PublicKey,
		from: Date,
		to: Date
	): Promise<NodeMeasurementDay[]>;

	findXDaysInactive(
		since: Date,
		numberOfDays: number
	): Promise<{ publicKey: string }[]>;

	findXDaysActiveButNotValidating(
		since: Date,
		numberOfDays: number
	): Promise<{ publicKey: string }[]>;
	save(nodeMeasurements: NodeMeasurementDay[]): Promise<void>;
}
