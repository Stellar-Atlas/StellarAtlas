import { Event, EventData } from '../event/Event.js';
import { EventSourceId } from '../event/EventSourceId.js';
import { Subscriber } from './Subscriber.js';

export interface Notification {
	subscriber: Subscriber;
	events: Event<EventData, EventSourceId>[];
	time: Date;
}
