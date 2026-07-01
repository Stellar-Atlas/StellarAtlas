import { Event, MultipleUpdatesEventData } from './Event.js';
import { OrganizationId, PublicKey } from './EventSourceId.js';

export interface EventRepository {
	findNodeEventsForXNetworkScans(
		x: number,
		at: Date
	): Promise<Event<MultipleUpdatesEventData, PublicKey>[]>;

	findOrganizationMeasurementEventsForXNetworkScans(
		x: number,
		at: Date
	): Promise<Event<MultipleUpdatesEventData, OrganizationId>[]>;
}
