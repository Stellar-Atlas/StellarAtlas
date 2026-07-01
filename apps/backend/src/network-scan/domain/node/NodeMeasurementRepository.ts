import type { MeasurementRepository } from '../measurement/MeasurementRepository.js';
import NodeMeasurement from './NodeMeasurement.js';
import { NodeMeasurementAverage } from './NodeMeasurementAverage.js';
import { NodeMeasurementEvent } from './NodeMeasurementEvent.js';

export interface NodeMeasurementRepository extends MeasurementRepository<NodeMeasurement> {
	findXDaysAverageAt(
		at: Date,
		xDays: number
	): Promise<NodeMeasurementAverage[]>;
	findEventsForXNetworkScans(
		x: number,
		at: Date
	): Promise<NodeMeasurementEvent[]>;
	save(nodeMeasurements: NodeMeasurement[]): Promise<void>;
	findInactiveAt(at: Date): Promise<{ nodeId: number }[]>;
}
