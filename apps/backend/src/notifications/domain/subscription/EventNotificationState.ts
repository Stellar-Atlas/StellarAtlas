import { Event, EventData, EventType } from '../event/Event.js';
import type { Subscription } from './Subscription.js';
import { Column, Entity, ManyToOne } from 'typeorm';
import { EventSourceId } from '../event/EventSourceId.js';
import { CoreEntity } from '@core/domain/CoreEntity.js';

@Entity('subscription_event_notification_state')
export class EventNotificationState extends CoreEntity {
	@Column({ type: 'timestamptz', nullable: false })
	public latestSendTime: Date;

	@Column({ type: 'enum', enum: EventType, nullable: false })
	eventType: EventType;

	@Column({ type: 'boolean', default: false })
	public ignoreCoolOffPeriod = false;

	@ManyToOne(
		'Subscription',
		(eventSubscription: Subscription) =>
			eventSubscription.eventNotificationStates,
		{
			eager: false,
			nullable: false,
			orphanedRowAction: 'delete',
			onDelete: 'CASCADE'
		}
	)
	public eventSubscription?: Subscription;

	private constructor(time: Date, eventType: EventType) {
		super();
		this.latestSendTime = time;
		this.eventType = eventType;
	}

	static createFromEvent(event: Event<EventData, EventSourceId>) {
		return new EventNotificationState(event.time, event.type);
	}

	public processEvent(event: Event<EventData, EventSourceId>) {
		this.latestSendTime = event.time;
		this.ignoreCoolOffPeriod = false;
	}
}
