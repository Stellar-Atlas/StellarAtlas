import { PendingSubscriptionId } from '../PendingSubscription.js';
import { randomUUID } from 'crypto';

export function createDummyPendingSubscriptionId(rawId?: string) {
	const pendingSubscriptionIdResult = PendingSubscriptionId.create(
		rawId ? rawId : randomUUID()
	);
	if (pendingSubscriptionIdResult.isErr())
		throw pendingSubscriptionIdResult.error;
	return pendingSubscriptionIdResult.value;
}
