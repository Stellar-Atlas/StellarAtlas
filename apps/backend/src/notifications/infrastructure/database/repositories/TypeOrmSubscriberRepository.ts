import { injectable } from 'inversify';
import { Repository } from 'typeorm';
import { Subscriber } from '@notifications/domain/subscription/Subscriber.js';
import type { SubscriberRepository } from '@notifications/domain/subscription/SubscriberRepository.js';
import { UserId } from '@notifications/domain/subscription/UserId.js';
import { randomUUID } from 'crypto';
import { PendingSubscriptionId } from '@notifications/domain/subscription/PendingSubscription.js';
import { SubscriberReference } from '@notifications/domain/subscription/SubscriberReference.js';

@injectable()
export class TypeOrmSubscriberRepository implements SubscriberRepository {
	constructor(private baseRepository: Repository<Subscriber>) {}

	async save(subscribers: Subscriber[]): Promise<Subscriber[]> {
		return await this.baseRepository.save(subscribers);
	}

	async savePendingIfAbsent(candidate: Subscriber): Promise<Subscriber> {
		return this.baseRepository.manager.transaction(async (manager) => {
			// The unique userId resolves simultaneous first registrations; the row
			// lock then protects the pending token without holding a lock over mail.
			await manager.query(
				`INSERT INTO subscription_subscriber
				("userIdValue", "subscriberReferenceValue", "registrationDate")
				VALUES ($1, $2, $3) ON CONFLICT ("userIdValue") DO NOTHING`,
				[
					candidate.userId.value,
					candidate.subscriberReference.value,
					candidate.registrationDate
				]
			);
			await manager.query(
				`SELECT id FROM subscription_subscriber
				WHERE "userIdValue" = $1 FOR UPDATE`,
				[candidate.userId.value]
			);
			const repository = manager.getRepository(Subscriber);
			const stored = await repository.findOneByOrFail({
				userId: candidate.userId
			});
			if (stored.pendingSubscription) return stored;
			stored.pendingSubscription = candidate.pendingSubscription;
			return repository.save(stored);
		});
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
