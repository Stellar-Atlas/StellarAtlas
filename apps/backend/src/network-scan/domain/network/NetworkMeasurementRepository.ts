import type { MeasurementRepository } from '../measurement/MeasurementRepository.js';
import NetworkMeasurement from './NetworkMeasurement.js';

export interface NetworkMeasurementRepository extends MeasurementRepository<NetworkMeasurement> {
	save(networkMeasurements: NetworkMeasurement[]): Promise<void>;
}
