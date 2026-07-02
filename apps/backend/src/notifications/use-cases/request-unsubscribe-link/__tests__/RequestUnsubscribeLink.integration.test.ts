import { decorate, injectable } from 'inversify';
import Kernel from '@core/infrastructure/Kernel.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { NodeV1 } from 'shared';
import type { SubscriberRepository } from '@notifications/domain/subscription/SubscriberRepository.js';
import { RequestUnsubscribeLinkDTO } from '../RequestUnsubscribeLinkDTO.js';
import { RequestUnsubscribeLink } from '../RequestUnsubscribeLink.js';
import { ok } from 'neverthrow';
import { createDummySubscriber } from '@notifications/domain/subscription/__fixtures__/Subscriber.fixtures.js';
import { UserService } from '@core/services/UserService.js';
import Mock = jest.Mock;
decorate(injectable(), UserService);
jest.mock('@core/services/UserService');

let kernel: Kernel;
jest.setTimeout(60000); //slow integration tests

const subscriber = createDummySubscriber();
const userId = subscriber.userId;
const findUserFn = jest.fn();
const sendFn = jest.fn();
let subscriberRepository: SubscriberRepository;
beforeAll(async () => {
	(UserService as Mock).mockImplementation(() => {
		return {
			findUser: findUserFn.mockResolvedValue(ok(userId)),
			send: sendFn.mockResolvedValue(ok(undefined))
		};
	});
	kernel = await Kernel.getInstance(new ConfigMock());
	subscriberRepository = kernel.container.get<SubscriberRepository>(
		'SubscriberRepository'
	);
});

afterAll(async () => {
	await kernel.close();
});

//test it should send message
it('should send message', async function () {
	await subscriberRepository.save([subscriber]);

	const dto: RequestUnsubscribeLinkDTO = {
		emailAddress: 'test@localhost.com',
		time: new Date()
	};

	const command = kernel.container.get<RequestUnsubscribeLink>(
		RequestUnsubscribeLink
	);
	const result = await command.execute(dto);
	expect(result.isOk()).toBeTruthy();
	expect(sendFn).toHaveBeenCalledTimes(1);
});
