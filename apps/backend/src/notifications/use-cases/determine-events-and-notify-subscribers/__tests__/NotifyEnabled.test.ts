import { jest, expect, it, describe } from '@jest/globals';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import type { NetworkV1 } from 'shared';
import type { Logger } from '@core/services/Logger.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { NetworkDTOService } from '@network-scan/services/NetworkDTOService.js';
import { EventDetector } from '../../../domain/event/EventDetector.js';
import { NetworkLossOfLivenessEvent } from '../../../domain/event/Event.js';
import { NetworkId } from '../../../domain/event/EventSourceId.js';
import { Notifier } from '../../../domain/notifier/Notifier.js';
import type { SubscriberRepository } from '../../../domain/subscription/SubscriberRepository.js';
import { createDummySubscriber } from '../../../domain/subscription/__fixtures__/Subscriber.fixtures.js';
import { NotifyHistoryArchiveIntegrityFailures } from '../../notify-history-archive-integrity/NotifyHistoryArchiveIntegrityFailures.js';
import { Notify } from '../Notify.js';
import {
	NoNetworkError,
	NoPreviousNetworkError,
	PersistenceError,
	NetworkStatisticsIncompleteError
} from '../NotifyError.js';

const time = new Date('2026-11-02T00:00:00Z');
function fixture(enabled?: boolean) {
	const network = mock<NetworkV1>(),
		previous = mock<NetworkV1>();
	const networks = mock<NetworkDTOService>(),
		detector = mock<EventDetector>();
	const subscribers = mock<SubscriberRepository>(),
		notifier = mock<Notifier>();
	const logger = mock<Logger>(),
		exceptions = mock<ExceptionLogger>();
	const archive = mock<NotifyHistoryArchiveIntegrityFailures>();
	const calls: string[] = [];
	archive.execute.mockImplementation(async () => {
		calls.push('archive');
		return ok({
			candidateEvents: 0,
			failedNotifications: 0,
			inspectedArchiveRoots: 0,
			sentNotifications: 0,
			skippedDueToConcurrentRun: false
		});
	});
	networks.getNetworkDTOAt.mockImplementation(async () => {
		calls.push('network');
		return ok(network);
	});
	networks.getPreviousNetworkDTO.mockImplementation(async () => {
		calls.push('previous');
		return ok(previous);
	});
	const event = new NetworkLossOfLivenessEvent(time, new NetworkId('fixture'), {
		from: 5,
		to: 1
	});
	detector.detect.mockImplementation(async () => {
		calls.push('detect');
		return ok([event]);
	});
	const subscriber = createDummySubscriber(),
		notification = { subscriber, events: [event], time };
	const publish = jest
		.spyOn(subscriber, 'publishNotificationAbout')
		.mockImplementation(() => {
			calls.push('publish');
			return notification;
		});
	subscribers.find.mockImplementation(async () => {
		calls.push('subscribers');
		return [subscriber];
	});
	notifier.sendNotifications.mockImplementation(async () => {
		calls.push('provider');
		return { successfulNotifications: [notification], failedNotifications: [] };
	});
	subscribers.save.mockImplementation(async (values) => {
		calls.push('save');
		return values;
	});
	const worker = new Notify(
		networks,
		detector,
		subscribers,
		notifier,
		logger,
		exceptions,
		archive,
		enabled ?? false
	);
	return {
		worker,
		networks,
		detector,
		subscribers,
		notifier,
		logger,
		exceptions,
		archive,
		calls,
		publish,
		notification,
		network,
		previous
	};
}

describe('global notification worker switch', () => {
	it.each([undefined, false])(
		'does no archive, generic or provider work when disabled/default (%s)',
		async (enabled) => {
			const f = fixture(enabled);
			expect((await f.worker.execute({ networkUpdateTime: time })).isOk()).toBe(
				true
			);
			expect(f.calls).toEqual([]);
			for (const method of [
				f.archive.execute,
				f.networks.getNetworkDTOAt,
				f.networks.getPreviousNetworkDTO,
				f.detector.detect,
				f.subscribers.find,
				f.publish,
				f.notifier.sendNotifications,
				f.subscribers.save,
				f.logger.info,
				f.logger.warn,
				f.exceptions.captureException
			])
				expect(method).not.toHaveBeenCalled();
		}
	);

	it('preserves archive-first order, generic message inputs and successful persistence when true', async () => {
		const f = fixture(true);
		expect((await f.worker.execute({ networkUpdateTime: time })).isOk()).toBe(
			true
		);
		expect(f.calls).toEqual([
			'archive',
			'network',
			'previous',
			'detect',
			'subscribers',
			'publish',
			'provider',
			'save'
		]);
		expect(f.detector.detect).toHaveBeenCalledWith(f.network, f.previous);
		expect(f.publish).toHaveBeenCalledWith(f.notification.events, time);
		expect(f.notifier.sendNotifications).toHaveBeenCalledWith([f.notification]);
		expect(f.subscribers.save).toHaveBeenCalledWith([
			f.notification.subscriber
		]);
	});

	it('retains archive-result error reporting and still performs generic notifications', async () => {
		const f = fixture(true),
			cause = new Error('fixture archive failure');
		f.archive.execute.mockResolvedValue(err(cause));
		expect((await f.worker.execute({ networkUpdateTime: time })).isOk()).toBe(
			true
		);
		expect(f.exceptions.captureException).toHaveBeenCalledWith(cause);
		expect(f.logger.warn).toHaveBeenCalledWith(
			'Archive integrity notification generation failed',
			{ cause: cause.message }
		);
		expect(f.notifier.sendNotifications).toHaveBeenCalledTimes(1);
	});

	it('retains thrown archive failure conversion without entering generic work', async () => {
		const f = fixture(true);
		f.archive.execute.mockRejectedValue(new Error('fixture thrown failure'));
		const result = await f.worker.execute({ networkUpdateTime: time });
		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error).toBeInstanceOf(PersistenceError);
			expect(f.exceptions.captureException).toHaveBeenCalledWith(result.error);
		}
		expect(f.networks.getNetworkDTOAt).not.toHaveBeenCalled();
	});

	it('retains missing-network and missing-previous-network results after archive work', async () => {
		const missing = fixture(true);
		missing.networks.getNetworkDTOAt.mockResolvedValue(ok(null));
		const first = await missing.worker.execute({ networkUpdateTime: time });
		expect(first.isErr()).toBe(true);
		if (first.isErr()) expect(first.error).toBeInstanceOf(NoNetworkError);
		expect(missing.archive.execute).toHaveBeenCalledTimes(1);
		expect(missing.detector.detect).not.toHaveBeenCalled();
		const previous = fixture(true);
		previous.networks.getPreviousNetworkDTO.mockResolvedValue(ok(null));
		const second = await previous.worker.execute({ networkUpdateTime: time });
		expect(second.isErr()).toBe(true);
		if (second.isErr())
			expect(second.error).toBeInstanceOf(NoPreviousNetworkError);
		expect(previous.archive.execute).toHaveBeenCalledTimes(1);
		expect(previous.notifier.sendNotifications).not.toHaveBeenCalled();
	});

	it('preserves detector error classification and does not generate messages', async () => {
		const f = fixture(true);
		f.detector.detect.mockResolvedValue(err(new Error('fixture incomplete')));
		const result = await f.worker.execute({ networkUpdateTime: time });
		expect(result.isErr()).toBe(true);
		if (result.isErr())
			expect(result.error).toBeInstanceOf(NetworkStatisticsIncompleteError);
		expect(f.subscribers.find).not.toHaveBeenCalled();
		expect(f.notifier.sendNotifications).not.toHaveBeenCalled();
	});

	it('keeps failed delivery reporting and persists only successful recipients', async () => {
		const f = fixture(true),
			cause = new Error('fixture delivery failure');
		f.notifier.sendNotifications.mockResolvedValue({
			successfulNotifications: [],
			failedNotifications: [{ notification: f.notification, cause }]
		});
		expect((await f.worker.execute({ networkUpdateTime: time })).isOk()).toBe(
			true
		);
		expect(f.subscribers.save).toHaveBeenCalledWith([]);
		expect(f.exceptions.captureException).toHaveBeenCalledWith(cause);
	});
});
