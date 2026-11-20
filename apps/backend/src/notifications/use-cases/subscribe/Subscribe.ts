import { EventSourceIdDTO, SubscribeDTO } from './SubscribeDTO.js';
import { err, ok, Result } from 'neverthrow';
import type { SubscriberRepository } from '../../domain/subscription/SubscriberRepository.js';
import { inject, injectable } from 'inversify';
import type { IUserService } from '@core/domain/IUserService.js';
import { Subscriber } from '../../domain/subscription/Subscriber.js';
import { EventSourceId } from '../../domain/event/EventSourceId.js';
import { EventSourceIdFactory } from '../../domain/event/EventSourceIdFactory.js';
import { SubscriberReference } from '../../domain/subscription/SubscriberReference.js';
import { PersistenceError } from './SubscribeError.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import type { MessageCreator } from '../../domain/notifier/MessageCreator.js';

export interface SubscriptionResult {
	subscribed: EventSourceIdDTO[];
	failed: FailedSubscription[];
}

export interface FailedSubscription {
	eventSourceId: EventSourceIdDTO;
	error: Error;
}

@injectable()
export class Subscribe {
	constructor(
		@inject(TYPES.MessageCreator) protected messageCreator: MessageCreator,
		protected eventSourceIdFactory: EventSourceIdFactory,
		@inject('SubscriberRepository')
		protected subscriberRepository: SubscriberRepository,
		@inject('UserService') protected userService: IUserService
	) {}

	async execute(
		subscribeDTO: SubscribeDTO
	): Promise<Result<SubscriptionResult, Error>> {
		try {
			const failedEventSourceIdDTOs: FailedSubscription[] = [];
			const subscribedEventSourceIdDTOs: EventSourceIdDTO[] = [];
			const eventSourceIds: EventSourceId[] = [];

			if (subscribeDTO.eventSourceIds.length === 0)
				return err(new Error('No event sources specified'));

			for (const eventSourceIdDTO of subscribeDTO.eventSourceIds) {
				const eventSourceIdResult = await this.eventSourceIdFactory.create(
					eventSourceIdDTO.type,
					eventSourceIdDTO.id,
					subscribeDTO.time
				);
				if (eventSourceIdResult.isErr()) {
					failedEventSourceIdDTOs.push({
						eventSourceId: eventSourceIdDTO,
						error: eventSourceIdResult.error
					});
				} else {
					subscribedEventSourceIdDTOs.push(eventSourceIdDTO);
					eventSourceIds.push(eventSourceIdResult.value);
				}
			}

			if (eventSourceIds.length === 0) {
				return ok({ subscribed: [], failed: failedEventSourceIdDTOs });
			}

			const userIdResult = await this.userService.findOrCreateUser(
				subscribeDTO.emailAddress
			);
			if (userIdResult.isErr()) return err(userIdResult.error);

			let subscriber = await this.subscriberRepository.findOneByUserId(
				userIdResult.value
			);
			if (subscriber === null)
				subscriber = Subscriber.create({
					userId: userIdResult.value,
					SubscriberReference: SubscriberReference.create(),
					registrationDate: subscribeDTO.time
				});

			if (!subscriber.pendingSubscription) {
				subscriber.addPendingSubscription(
					this.subscriberRepository.nextPendingSubscriptionId(),
					eventSourceIds,
					subscribeDTO.time
				);
				subscriber =
					await this.subscriberRepository.savePendingIfAbsent(subscriber);
			}
			const existingPending = subscriber.pendingSubscription;
			if (!existingPending)
				throw new Error('Pending subscription was not persisted');
			const pendingSubscriptionId = existingPending.pendingSubscriptionId;
			// A refused or ambiguous resend must not invalidate an emailed link or
			// change the event sources that its token authorizes.

			const message =
				await this.messageCreator.createConfirmSubscriptionMessage(
					pendingSubscriptionId
				);
			const result = await this.userService.send(subscriber.userId, message);

			if (result.isErr()) return err(result.error);

			return ok({
				subscribed: subscribedEventSourceIdDTOs.filter((dto, index) => {
					if (
						!existingPending ||
						existingPending.eventSourceIds.some((source) =>
							source.equals(eventSourceIds[index])
						)
					)
						return true;
					failedEventSourceIdDTOs.push({
						eventSourceId: dto,
						error: new Error(
							'Confirm the existing pending subscription before changing subscriptions'
						)
					});
					return false;
				}),
				failed: failedEventSourceIdDTOs
			});
		} catch (e) {
			return err(new PersistenceError(mapUnknownToError(e)));
		}
	}
}
