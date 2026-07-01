import { UserId } from './UserId.js';
import { Subscriber } from './Subscriber.js';
import { PendingSubscriptionId } from './PendingSubscription.js';
import { SubscriberReference } from './SubscriberReference.js';

export interface SubscriberRepository {
	find(): Promise<Subscriber[]>;
	findOneByUserId(userId: UserId): Promise<Subscriber | null>;
	findOneBySubscriberReference(
		subscriberReference: SubscriberReference
	): Promise<Subscriber | null>;
	findOneByPendingSubscriptionId(
		pendingSubscriptionId: PendingSubscriptionId
	): Promise<Subscriber | null>;
	nextPendingSubscriptionId(): PendingSubscriptionId;
	save(subscribers: Subscriber[]): Promise<Subscriber[]>;
	remove(subscriber: Subscriber): Promise<Subscriber>;
}
