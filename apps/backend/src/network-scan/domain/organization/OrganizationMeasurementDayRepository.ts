import type { MeasurementAggregationRepository } from '../measurement-aggregation/MeasurementAggregationRepository.js';
import { OrganizationMeasurementAverage } from './OrganizationMeasurementAverage.js';
import OrganizationMeasurementDay from './OrganizationMeasurementDay.js';
import { OrganizationId } from './OrganizationId.js';

export interface OrganizationMeasurementDayRepository extends MeasurementAggregationRepository<OrganizationMeasurementDay> {
	findXDaysAverageAt(
		at: Date,
		xDays: number
	): Promise<OrganizationMeasurementAverage[]>;

	findBetween(
		organizationId: OrganizationId,
		from: Date,
		to: Date
	): Promise<OrganizationMeasurementDay[]>;
}
