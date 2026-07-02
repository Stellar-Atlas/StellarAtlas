import { RequestUnsubscribeLink } from '../RequestUnsubscribeLink.js';
import { mock } from 'jest-mock-extended';
import type { MessageCreator } from '@notifications/domain/notifier/MessageCreator.js';
import type { SubscriberRepository } from '@notifications/domain/subscription/SubscriberRepository.js';
import type { IUserService } from '@core/domain/IUserService.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import type { Logger } from 'logger';
import { err, ok } from 'neverthrow';
import { createDummySubscriber } from '@notifications/domain/subscription/__fixtures__/Subscriber.fixtures.js';
import { Message } from '@core/domain/Message.js';

describe('RequestUnsubscribeLink', () => {
	function setupSUT() {
		const messageCreator = mock<MessageCreator>();
		const subscriberRepository = mock<SubscriberRepository>();
		const userService = mock<IUserService>();
		const exceptionLogger = mock<ExceptionLogger>();
		const logger = mock<Logger>();

		const requestUnsubscribeLink = new RequestUnsubscribeLink(
			messageCreator,
			subscriberRepository,
			userService,
			exceptionLogger,
			logger
		);

		//setup mocks
		const subscriber = createDummySubscriber();
		userService.findUser.mockResolvedValue(ok(subscriber.userId));
		subscriberRepository.findOneByUserId.mockResolvedValue(subscriber);
		userService.send.mockResolvedValue(ok(undefined));
		const message: Message = {
			body: 'test',
			title: 'test'
		};
		const time = new Date();
		const emailAddress = 'test@localhost.com';

		messageCreator.createUnsubscribeMessage.mockResolvedValue(message);
		return {
			messageCreator,
			subscriberRepository,
			userService,
			requestUnsubscribeLink,
			subscriber,
			message,
			time,
			emailAddress
		};
	}

	it('should send unsubscribe message when user is subscribed', async () => {
		const {
			messageCreator,
			subscriberRepository,
			userService,
			requestUnsubscribeLink,
			subscriber,
			message,
			time,
			emailAddress
		} = setupSUT();

		const result = await requestUnsubscribeLink.execute({
			emailAddress: emailAddress,
			time: time
		});

		expect(result.isOk()).toBeTruthy();
		expect(userService.send).toHaveBeenCalledTimes(1);
		expect(userService.findUser).toHaveBeenCalledTimes(1);
		expect(userService.findUser).toHaveBeenCalledWith(emailAddress);
		expect(subscriberRepository.findOneByUserId).toHaveBeenCalledTimes(1);
		expect(subscriberRepository.findOneByUserId).toHaveBeenCalledWith(
			subscriber.userId
		);
		expect(messageCreator.createUnsubscribeMessage).toHaveBeenCalledTimes(1);
		expect(messageCreator.createUnsubscribeMessage).toHaveBeenCalledWith(
			subscriber.subscriberReference,
			time
		);
		expect(userService.send).toHaveBeenCalledTimes(1);
		expect(userService.send).toHaveBeenCalledWith(subscriber.userId, message);
	});

	it('should not send unsubscribe message when user is not subscribed', async () => {
		const {
			subscriberRepository,
			userService,
			requestUnsubscribeLink,
			time,
			emailAddress
		} = setupSUT();

		subscriberRepository.findOneByUserId.mockResolvedValue(null);

		const result = await requestUnsubscribeLink.execute({
			emailAddress: emailAddress,
			time: time
		});

		expect(result.isOk()).toBeTruthy();
		expect(userService.send).toHaveBeenCalledTimes(0);
	});

	it('should not send unsubscribe message when user is not found', async () => {
		const { userService, requestUnsubscribeLink, time, emailAddress } =
			setupSUT();

		userService.findUser.mockResolvedValue(ok(null));

		const result = await requestUnsubscribeLink.execute({
			emailAddress: emailAddress,
			time: time
		});

		expect(result.isOk()).toBeTruthy();
		expect(userService.send).toHaveBeenCalledTimes(0);
	});

	it('should return error when user service returns error', async () => {
		const { userService, requestUnsubscribeLink, time, emailAddress } =
			setupSUT();

		userService.findUser.mockResolvedValue(err(new Error('test')));

		const result = await requestUnsubscribeLink.execute({
			emailAddress: emailAddress,
			time: time
		});

		expect(result.isErr()).toBeTruthy();
		expect(userService.send).toHaveBeenCalledTimes(0);
	});

	it('should return error when subscriber repository throws error', async () => {
		const {
			subscriberRepository,
			userService,
			requestUnsubscribeLink,
			time,
			emailAddress
		} = setupSUT();

		subscriberRepository.findOneByUserId.mockRejectedValue(new Error('test'));

		const result = await requestUnsubscribeLink.execute({
			emailAddress: emailAddress,
			time: time
		});

		expect(result.isErr()).toBeTruthy();
		expect(subscriberRepository.findOneByUserId).toHaveBeenCalledTimes(1);
		expect(userService.send).toHaveBeenCalledTimes(0);
	});

	it('should return error when message creator throws error', async () => {
		const {
			messageCreator,
			subscriberRepository,
			userService,
			requestUnsubscribeLink,
			subscriber,
			time,
			emailAddress
		} = setupSUT();

		messageCreator.createUnsubscribeMessage.mockRejectedValue(
			new Error('test')
		);

		const result = await requestUnsubscribeLink.execute({
			emailAddress: emailAddress,
			time: time
		});

		expect(result.isErr()).toBeTruthy();
		expect(subscriberRepository.findOneByUserId).toHaveBeenCalledTimes(1);
		expect(userService.send).toHaveBeenCalledTimes(0);
	});

	it('should return error when user service send returns error', async () => {
		const {
			messageCreator,
			subscriberRepository,
			userService,
			requestUnsubscribeLink,
			subscriber,
			time,
			emailAddress
		} = setupSUT();

		userService.send.mockResolvedValue(err(new Error('test')));

		const result = await requestUnsubscribeLink.execute({
			emailAddress: emailAddress,
			time: time
		});

		expect(result.isErr()).toBeTruthy();
		expect(userService.send).toHaveBeenCalledTimes(1);
	});
});
