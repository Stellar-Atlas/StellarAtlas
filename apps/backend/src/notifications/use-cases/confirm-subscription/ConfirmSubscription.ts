import { inject, injectable } from 'inversify';
import { ConfirmSubscriptionDTO } from './ConfirmSubscriptionDTO.js';
import { err, ok, Result } from 'neverthrow';
import type { SubscriberRepository } from '../../domain/subscription/SubscriberRepository.js';
import { PendingSubscriptionId } from '../../domain/subscription/PendingSubscription.js';
import {
	NoPendingSubscriptionFound,
	PersistenceError
} from './ConfirmSubscriptionError.js';
import { mapUnknownToError } from '../../../core/utilities/mapUnknownToError.js';

@injectable()
export class ConfirmSubscription {
	constructor(
		@inject('SubscriberRepository')
		protected SubscriberRepository: SubscriberRepository
	) {}

	async execute(dto: ConfirmSubscriptionDTO): Promise<Result<void, Error>> {
		try {
			const pendingSubscriptionIdResult = PendingSubscriptionId.create(
				dto.pendingSubscriptionId
			);
			if (pendingSubscriptionIdResult.isErr())
				return err(pendingSubscriptionIdResult.error);

			const subscriber =
				await this.SubscriberRepository.findOneByPendingSubscriptionId(
					pendingSubscriptionIdResult.value
				);
			if (subscriber === null) return err(new NoPendingSubscriptionFound());

			const result = subscriber.confirmPendingSubscription(
				pendingSubscriptionIdResult.value
			);
			if (result.isErr()) return err(result.error);

			await this.SubscriberRepository.save([subscriber]);

			return ok(undefined);
		} catch (e) {
			return err(new PersistenceError(mapUnknownToError(e)));
		}
	}
}
