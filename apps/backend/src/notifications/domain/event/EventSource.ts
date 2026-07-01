import { EventSourceId } from './EventSourceId.js';

export class EventSource {
	constructor(
		public readonly eventSourceId: EventSourceId,
		public readonly name: string
	) {}
}
