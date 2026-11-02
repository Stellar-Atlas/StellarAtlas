import 'reflect-metadata';
import { jest, expect, it, beforeEach, afterEach } from '@jest/globals';
import { Container } from 'inversify';
import { DataSource } from 'typeorm';
import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type { HttpService } from 'http-helper';
import type { NetworkV1 } from 'shared';
import { DefaultConfig, type NetworkConfig } from '@core/config/Config.js';
import type { CrawlerConfiguration } from 'crawler';
import type { Logger } from '@core/services/Logger.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { User } from '@core/infrastructure/database/entities/User.js';
import { Message } from '@core/domain/Message.js';
import { UserService } from '@core/services/UserService.js';
import { NetworkDTOService } from '@network-scan/services/NetworkDTOService.js';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import type { HistoryArchiveObjectRepository } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { TYPES as HISTORY_TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import type { SubscriberRepository } from '../../../domain/subscription/SubscriberRepository.js';
import type { ArchiveFindingStateRepository } from '../../../domain/subscription/ArchiveFindingState.js';
import type { MessageCreator } from '../../../domain/notifier/MessageCreator.js';
import type { EventSourceService } from '../../../domain/event/EventSourceService.js';
import { EventDetector } from '../../../domain/event/EventDetector.js';
import { NetworkLossOfLivenessEvent } from '../../../domain/event/Event.js';
import { NetworkId } from '../../../domain/event/EventSourceId.js';
import { createDummySubscriber } from '../../../domain/subscription/__fixtures__/Subscriber.fixtures.js';
import { createDummyPendingSubscriptionId } from '../../../domain/subscription/__fixtures__/PendingSubscriptionId.fixtures.js';
import { fixtureNode } from '../../../use-cases/notify-history-archive-integrity/__fixtures__/CurrentNotificationStore.js';
import { NotifyHistoryArchiveIntegrityFailures } from '../../../use-cases/notify-history-archive-integrity/NotifyHistoryArchiveIntegrityFailures.js';
import { Notify } from '../../../use-cases/determine-events-and-notify-subscribers/Notify.js';
import { RequestUnsubscribeLink } from '../../../use-cases/request-unsubscribe-link/RequestUnsubscribeLink.js';
import { Subscribe } from '../../../use-cases/subscribe/Subscribe.js';
import { TYPES } from '../di-types.js';

// Only the fixed mail transport module is substituted. The notification loader,
// Notify, Notifier and selected SMTP service are the real implementations.
const sendMail =
	jest.fn<(...args: unknown[]) => Promise<{ messageId: string }>>();
const verify = jest.fn<() => Promise<boolean>>();
const createTransport = jest.fn(() => ({ sendMail, verify }));
jest.unstable_mockModule('nodemailer', () => ({ createTransport }));
const { load } = await import('../container.js');

const time = new Date('2026-11-02T00:00:00Z');
beforeEach(() => {
	jest.clearAllMocks();
	sendMail.mockResolvedValue({ messageId: 'fixture' });
});
afterEach(() => {
	jest.restoreAllMocks();
});

function fixture(enabled?: boolean, localSMTP = true) {
	const config = new DefaultConfig(
		mock<NetworkConfig>(),
		{ value: 'https://horizon.fixture.invalid' },
		'fixture-only',
		mock<CrawlerConfiguration>()
	);
	config.enableNotifications = enabled ?? config.enableNotifications;
	config.enableLocalSMTP = localSMTP;
	config.smtpHost = 'smtp.fixture.invalid';
	config.smtpPort = 587;
	config.smtpSecure = false;
	config.smtpUsername = 'fixture-user';
	config.smtpPassword = 'fixture-only';
	config.smtpFromAddress = 'sender@fixture.invalid';
	config.userServiceBaseUrl = 'https://mail.fixture.invalid';
	config.userServiceUsername = 'fixture-user';
	config.userServicePassword = 'fixture-only';
	const source = new DataSource({ type: 'postgres', entities: [User] });
	const query = jest
		.spyOn(source, 'createQueryRunner')
		.mockImplementation(() => {
			throw new Error('No SQL permitted in this DI fixture');
		});
	const subscriber = createDummySubscriber(),
		user = new User();
	user.id = subscriber.userId.value;
	user.email = 'recipient@fixture.invalid';
	const userRead = jest
		.spyOn(source.getRepository(User), 'findOne')
		.mockResolvedValue(user);
	const subscribers = mock<SubscriberRepository>(),
		networks = mock<NetworkDTOService>(),
		detector = mock<EventDetector>();
	const nodes = mock<NodeRepository>(),
		objects = mock<HistoryArchiveObjectRepository>();
	const http = mock<HttpService>(),
		logger = mock<Logger>(),
		exceptions = mock<ExceptionLogger>();
	const creator = mock<MessageCreator>(),
		sources = mock<EventSourceService>();
	const message = new Message('<p>Fixture message</p>', 'Fixture subject');
	creator.createNotificationMessage.mockResolvedValue(message);
	creator.createConfirmSubscriptionMessage.mockResolvedValue(message);
	creator.createUnsubscribeMessage.mockResolvedValue(message);
	sources.isEventSourceIdKnown.mockResolvedValue(ok(true));
	subscribers.findOneByUserId.mockResolvedValue(subscriber);
	subscribers.nextPendingSubscriptionId.mockReturnValue(
		createDummyPendingSubscriptionId()
	);
	subscribers.save.mockImplementation(async (values) => values);
	const container = new Container();
	container.bind(DataSource).toConstantValue(source);
	container.bind(NetworkDTOService).toConstantValue(networks);
	container.bind('HttpService').toConstantValue(http);
	container.bind('Logger').toConstantValue(logger);
	container.bind('ExceptionLogger').toConstantValue(exceptions);
	container.bind(NETWORK_TYPES.NodeRepository).toConstantValue(nodes);
	container
		.bind(HISTORY_TYPES.HistoryArchiveObjectRepository)
		.toConstantValue(objects);
	load(container, config);
	container.rebind('SubscriberRepository').toConstantValue(subscribers);
	container.rebind(EventDetector).toConstantValue(detector);
	container.rebind(TYPES.MessageCreator).toConstantValue(creator);
	container.rebind(TYPES.EventSourceService).toConstantValue(sources);
	const findings = container.get<ArchiveFindingStateRepository>(
		'ArchiveFindingStateRepository'
	);
	container.rebind('ArchiveFindingStateRepository').toConstantValue(findings);
	const prepare = jest.spyOn(findings, 'prepare'),
		ack = jest.spyOn(findings, 'acknowledge');
	const archive = container.get(NotifyHistoryArchiveIntegrityFailures);
	container
		.rebind(NotifyHistoryArchiveIntegrityFailures)
		.toConstantValue(archive);
	const archiveExecute = jest.spyOn(archive, 'execute');
	const worker = container.get(Notify);
	return {
		config,
		container,
		source,
		query,
		userRead,
		subscribers,
		subscriber,
		networks,
		detector,
		nodes,
		objects,
		http,
		creator,
		message,
		archiveExecute,
		prepare,
		ack,
		worker
	};
}

it.each([undefined, false])(
	'real SMTP DI honors false/default without reads, reservations, ACK or delivery (%s)',
	async (enabled) => {
		const f = fixture(enabled);
		expect(f.config.enableNotifications).toBe(false);
		expect(createTransport).toHaveBeenCalledTimes(1);
		expect((await f.worker.execute({ networkUpdateTime: time })).isOk()).toBe(
			true
		);
		for (const method of [
			f.archiveExecute,
			f.objects.findActionableByArchiveUrl,
			f.nodes.findAllKnown,
			f.prepare,
			f.ack,
			f.query,
			f.userRead,
			f.networks.getNetworkDTOAt,
			f.networks.getPreviousNetworkDTO,
			f.detector.detect,
			f.subscribers.find,
			f.subscribers.save,
			f.creator.createNotificationMessage,
			sendMail,
			verify
		])
			expect(method).not.toHaveBeenCalled();
		expect(f.source.isInitialized).toBe(false);
	}
);

it('real external-service DI honors false without provider HTTP calls', async () => {
	const f = fixture(false, false);
	expect(f.container.get('UserService')).toBeInstanceOf(UserService);
	expect((await f.worker.execute({ networkUpdateTime: time })).isOk()).toBe(
		true
	);
	expect(f.archiveExecute).not.toHaveBeenCalled();
	expect(f.query).not.toHaveBeenCalled();
	expect(f.http.post).not.toHaveBeenCalled();
	expect(f.http.get).not.toHaveBeenCalled();
	expect(f.networks.getNetworkDTOAt).not.toHaveBeenCalled();
	expect(createTransport).not.toHaveBeenCalled();
});

it('real true binding runs archive first and sends the unchanged generic message through capturing SMTP', async () => {
	const f = fixture(true),
		calls: string[] = [],
		network = mock<NetworkV1>();
	f.archiveExecute.mockImplementation(async () => {
		calls.push('archive');
		return ok({
			candidateEvents: 0,
			failedNotifications: 0,
			inspectedArchiveRoots: 0,
			sentNotifications: 0,
			skippedDueToConcurrentRun: false
		});
	});
	f.networks.getNetworkDTOAt.mockImplementation(async () => {
		calls.push('network');
		return ok(network);
	});
	f.networks.getPreviousNetworkDTO.mockImplementation(async () => {
		calls.push('previous');
		return ok(network);
	});
	const event = new NetworkLossOfLivenessEvent(time, new NetworkId('fixture'), {
		from: 5,
		to: 1
	});
	f.detector.detect.mockImplementation(async () => {
		calls.push('detect');
		return ok([event]);
	});
	const notification = { subscriber: f.subscriber, events: [event], time };
	jest
		.spyOn(f.subscriber, 'publishNotificationAbout')
		.mockReturnValue(notification);
	f.subscribers.find.mockResolvedValue([f.subscriber]);
	sendMail.mockImplementation(async () => {
		calls.push('smtp');
		return { messageId: 'fixture' };
	});
	expect((await f.worker.execute({ networkUpdateTime: time })).isOk()).toBe(
		true
	);
	expect(calls).toEqual(['archive', 'network', 'previous', 'detect', 'smtp']);
	expect(f.creator.createNotificationMessage).toHaveBeenCalledWith(
		notification
	);
	expect(sendMail).toHaveBeenCalledWith({
		from: 'sender@fixture.invalid',
		to: 'recipient@fixture.invalid',
		subject: f.message.title,
		html: f.message.body
	});
	expect(f.subscribers.save).toHaveBeenCalledWith([f.subscriber]);
	expect(f.source.isInitialized).toBe(false);
	expect(f.query).not.toHaveBeenCalled();
});

it('leaves requested unsubscribe-link delivery outside the disabled worker gate', async () => {
	const f = fixture(false);
	expect((await f.worker.execute({ networkUpdateTime: time })).isOk()).toBe(
		true
	);
	const result = await f.container
		.get(RequestUnsubscribeLink)
		.execute({ emailAddress: 'recipient@fixture.invalid', time });
	expect(result.isOk()).toBe(true);
	expect(sendMail).toHaveBeenCalledTimes(1);
	expect(f.creator.createUnsubscribeMessage).toHaveBeenCalled();
	expect(f.archiveExecute).not.toHaveBeenCalled();
});

it('leaves subscription confirmation delivery outside the disabled worker gate', async () => {
	const f = fixture(false);
	const result = await f.container.get(Subscribe).execute({
		time,
		emailAddress: 'recipient@fixture.invalid',
		eventSourceIds: [{ type: 'node', id: fixtureNode.value }]
	});
	expect(result.isOk()).toBe(true);
	expect(f.creator.createConfirmSubscriptionMessage).toHaveBeenCalledTimes(1);
	expect(sendMail).toHaveBeenCalledTimes(1);
	expect(f.archiveExecute).not.toHaveBeenCalled();
});
