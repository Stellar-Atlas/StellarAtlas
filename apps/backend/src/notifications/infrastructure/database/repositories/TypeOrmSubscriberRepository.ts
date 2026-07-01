import { injectable } from 'inversify';
import { Repository } from 'typeorm';
import { Subscriber } from '../../../domain/subscription/Subscriber.js';
import type { SubscriberRepository } from '../../../domain/subscription/SubscriberRepository.js';
import { UserId } from '../../../domain/subscription/UserId.js';
import { randomUUID } from 'crypto';
import { PendingSubscriptionId } from '../../../domain/subscription/PendingSubscription.js';
import { SubscriberReference } from '../../../domain/subscription/SubscriberReference.js';

@injectable()
export class TypeOrmSubscriberRepository implements SubscriberRepository {
	constructor(private baseRepository: Repository<Subscriber>) {}

	async save(subscribers: Subscriber[]): Promise<Subscriber[]> {
		return await this.baseRepository.save(subscribers);
	}

	find(): Promise<Subscriber[]> {
		return this.baseRepository.find();
	}

	remove(subscriber: Subscriber): Promise<Subscriber> {
		return this.baseRepository.remove(subscriber);
	}

	nextPendingSubscriptionId(): PendingSubscriptionId {
		const pendingSubscriptionIdResult =
			PendingSubscriptionId.create(randomUUID());
		if (pendingSubscriptionIdResult.isErr())
			throw pendingSubscriptionIdResult.error;
		return pendingSubscriptionIdResult.value;
	}

	async findOneByPendingSubscriptionId(
		pendingSubscriptionId: PendingSubscriptionId
	): Promise<Subscriber | null> {
		const subscriber = await this.baseRepository.findOne({
			relations: ['pendingSubscription'],
			where: {
				pendingSubscription: {
					pendingSubscriptionId: {
						value: pendingSubscriptionId.value
					}
				}
			}
		});

		return subscriber ? subscriber : null;
	}

	async findOneByUserId(userId: UserId): Promise<Subscriber | null> {
		const subscriber = await this.baseRepository.findOne({
			where: {
				userId: userId
			}
		});

		return subscriber ? subscriber : null;
	}

	async findOneBySubscriberReference(
		subscriberReference: SubscriberReference
	): Promise<Subscriber | null> {
		const subscriber = await this.baseRepository.findOne({
			where: {
				subscriberReference: subscriberReference
			}
		});

		return subscriber ? subscriber : null;
	}
}
