import type { MeasurementRepository } from '../measurement/MeasurementRepository.js';
import OrganizationMeasurement from './OrganizationMeasurement.js';
import { OrganizationMeasurementAverage } from './OrganizationMeasurementAverage.js';
import { OrganizationMeasurementEvent } from './OrganizationMeasurementEvent.js';
import type { OrganizationTomlEvidenceRecord } from './scan/OrganizationTomlAttempt.js';

export interface OrganizationMeasurementRepository extends MeasurementRepository<OrganizationMeasurement> {
	findXDaysAverageAt(
		at: Date,
		xDays: number
	): Promise<OrganizationMeasurementAverage[]>;
	findEventsForXNetworkScans(
		x: number,
		at: Date
	): Promise<OrganizationMeasurementEvent[]>;
	findTomlEvidenceAt(
		organizationIds: string[],
		at: Date
	): Promise<OrganizationTomlEvidenceRecord[]>;
	save(organizationMeasurements: OrganizationMeasurement[]): Promise<void>;
}
