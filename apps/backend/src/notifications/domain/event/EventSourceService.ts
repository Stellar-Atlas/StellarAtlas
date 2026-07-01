import { Result } from 'neverthrow';
import { EventSourceId } from './EventSourceId.js';
import { EventSource } from './EventSource.js';

export interface EventSourceService {
	isEventSourceIdKnown(
		eventSourceId: EventSourceId,
		time: Date
	): Promise<Result<boolean, Error>>;

	findEventSource(
		eventSourceId: EventSourceId,
		time: Date
	): Promise<Result<EventSource, Error>>;
}
