import 'reflect-metadata';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import type { IUserService } from '@core/domain/IUserService.js';
import { Message } from '@core/domain/Message.js';
import type { MessageCreator } from '@notifications/domain/notifier/MessageCreator.js';
import type { SubscriberRepository } from '@notifications/domain/subscription/SubscriberRepository.js';
import { createDummySubscriber } from '@notifications/domain/subscription/__fixtures__/Subscriber.fixtures.js';
import { createDummyPendingSubscriptionId } from '@notifications/domain/subscription/__fixtures__/PendingSubscriptionId.fixtures.js';
import { EventSourceIdFactory } from '@notifications/domain/event/EventSourceIdFactory.js';
import { NetworkId } from '@notifications/domain/event/EventSourceId.js';
import { EmailRateLimitError } from 'shared/lib/email/WeeklyEmailGate.js';
import { Subscribe } from '../Subscribe.js';
import { SubscribeDTO } from '../SubscribeDTO.js';

function fixture() {
	const subscriber = createDummySubscriber();
	const repository = mock<SubscriberRepository>();
	const users = mock<IUserService>();
	const messages = mock<MessageCreator>();
	const sourceIds = mock<EventSourceIdFactory>();
	const nextId = createDummyPendingSubscriptionId();
	const message = new Message('confirmation', 'Confirm subscription');
	repository.findOneByUserId.mockResolvedValue(subscriber);
	repository.nextPendingSubscriptionId.mockReturnValue(nextId);
	repository.savePendingIfAbsent.mockImplementation(
		async (subscriber) => subscriber
	);
	users.findOrCreateUser.mockResolvedValue(ok(subscriber.userId));
	users.send.mockResolvedValue(ok(undefined));
	messages.createConfirmSubscriptionMessage.mockResolvedValue(message);
	sourceIds.create.mockImplementation(async (_type, id) =>
		ok(new NetworkId(id))
	);
	const dto = new SubscribeDTO(
		'subscriber@example.test',
		[{ type: 'network', id: 'public' }],
		new Date('2026-11-20T12:00:00Z')
	);
	return {
		subscriber,
		repository,
		users,
		messages,
		nextId,
		message,
		dto,
		subscribe: new Subscribe(messages, sourceIds, repository, users)
	};
}

it('persists a first pending subscription before sending its confirmation', async () => {
	const f = fixture();
	f.repository.findOneByUserId.mockResolvedValue(null);
	const result = await f.subscribe.execute(f.dto);
	expect(result.isOk()).toBe(true);
	expect(f.repository.savePendingIfAbsent).toHaveBeenCalledTimes(1);
	const savedSubscriber = f.repository.savePendingIfAbsent.mock.calls[0][0];
	expect(savedSubscriber.pendingSubscription?.pendingSubscriptionId).toBe(
		f.nextId
	);
	expect(savedSubscriber.pendingSubscription?.eventSourceIds).toEqual([
		new NetworkId('public')
	]);
	expect(f.messages.createConfirmSubscriptionMessage).toHaveBeenCalledWith(
		f.nextId
	);
	expect(f.users.send).toHaveBeenCalledWith(savedSubscriber.userId, f.message);
});

it('uses the atomically persisted winner token when a concurrent first request loses', async () => {
	const f = fixture();
	f.repository.findOneByUserId.mockResolvedValue(null);
	const winnerId = createDummyPendingSubscriptionId();
	f.subscriber.addPendingSubscription(
		winnerId,
		[new NetworkId('public')],
		f.dto.time
	);
	f.repository.savePendingIfAbsent.mockResolvedValue(f.subscriber);
	f.users.send.mockResolvedValue(err(new EmailRateLimitError()));
	expect((await f.subscribe.execute(f.dto)).isErr()).toBe(true);
	expect(f.messages.createConfirmSubscriptionMessage).toHaveBeenCalledWith(
		winnerId
	);
	expect(f.subscriber.pendingSubscription?.pendingSubscriptionId).toBe(
		winnerId
	);
	expect(f.repository.save).not.toHaveBeenCalled();
});

it.each([new EmailRateLimitError(), new Error('Provider outcome unknown')])(
	'preserves the old token and sources after a refused or ambiguous resend: %s',
	async (sendError) => {
		const f = fixture();
		const oldId = createDummyPendingSubscriptionId();
		f.subscriber.addPendingSubscription(
			oldId,
			[new NetworkId('test')],
			new Date('2026-11-19T12:00:00Z')
		);
		const pending = f.subscriber.pendingSubscription;
		f.users.send.mockResolvedValue(err(sendError));

		const result = await f.subscribe.execute(f.dto);

		expect(result.isErr() && result.error).toBe(sendError);
		expect(f.subscriber.pendingSubscription).toBe(pending);
		expect(f.subscriber.pendingSubscription?.eventSourceIds).toEqual([
			new NetworkId('test')
		]);
		expect(f.repository.nextPendingSubscriptionId).not.toHaveBeenCalled();
		expect(f.repository.save).not.toHaveBeenCalled();
		expect(f.messages.createConfirmSubscriptionMessage).toHaveBeenCalledWith(
			oldId
		);
		expect(f.users.send).toHaveBeenCalledTimes(1);
	}
);

it('resends the existing authorization without reporting newly requested sources as subscribed', async () => {
	const f = fixture();
	const oldId = createDummyPendingSubscriptionId();
	f.subscriber.addPendingSubscription(
		oldId,
		[new NetworkId('public')],
		f.dto.time
	);
	const pending = f.subscriber.pendingSubscription;
	const result = await f.subscribe.execute(
		new SubscribeDTO(
			f.dto.emailAddress,
			[
				{ type: 'network', id: 'public' },
				{ type: 'network', id: 'test' }
			],
			f.dto.time
		)
	);

	expect(result.isOk()).toBe(true);
	if (result.isOk()) {
		expect(result.value.subscribed).toEqual([
			{ type: 'network', id: 'public' }
		]);
		expect(result.value.failed.map((failure) => failure.eventSourceId)).toEqual(
			[{ type: 'network', id: 'test' }]
		);
	}
	expect(f.subscriber.pendingSubscription).toBe(pending);
	expect(f.repository.save).not.toHaveBeenCalled();
	expect(f.messages.createConfirmSubscriptionMessage).toHaveBeenCalledWith(
		oldId
	);
});
