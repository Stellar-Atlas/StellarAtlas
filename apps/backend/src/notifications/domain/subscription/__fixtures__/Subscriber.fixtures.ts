import { Subscriber } from '../Subscriber.js';
import { UserId } from '../UserId.js';
import { randomUUID } from 'crypto';
import { SubscriberReference } from '../SubscriberReference.js';

export function createDummySubscriber(
	userId: UserId | null = null
): Subscriber {
	if (!userId) {
		userId = createDummyUserId();
	}
	return Subscriber.create({
		userId: userId,
		SubscriberReference: SubscriberReference.create(),
		registrationDate: new Date()
	});
}

export function createDummyUserId(): UserId {
	const userIdResult = UserId.create(randomUUID());
	if (userIdResult.isErr()) throw userIdResult.error;
	return userIdResult.value;
}
