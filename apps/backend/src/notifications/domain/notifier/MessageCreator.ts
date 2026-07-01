import { PendingSubscriptionId } from '../subscription/PendingSubscription.js';
import { Message } from '../../../core/domain/Message.js';
import { Notification } from '../subscription/Notification.js';
import { SubscriberReference } from '../subscription/SubscriberReference.js';

export interface MessageCreator {
	createConfirmSubscriptionMessage(
		pendingSubscriptionId: PendingSubscriptionId
	): Promise<Message>;

	createNotificationMessage(notification: Notification): Promise<Message>;

	createUnsubscribeMessage(
		subscriberReference: SubscriberReference,
		time: Date
	): Promise<Message>;
}
