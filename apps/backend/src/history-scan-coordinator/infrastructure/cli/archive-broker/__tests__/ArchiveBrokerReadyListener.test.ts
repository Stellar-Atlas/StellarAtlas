import { EventEmitter } from 'node:events';
import type { Logger } from 'logger';
import {
	ArchiveBrokerReadyListener,
	archiveBrokerRamNotificationChannel,
	type ArchiveBrokerNotificationClient
} from '../ArchiveBrokerReadyListener.js';
import { historyArchiveReadyNotificationChannel } from '../../../repositories/database/HistoryArchiveObjectReadyQueue.js';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
class Client extends EventEmitter implements ArchiveBrokerNotificationClient {
	connect = jest.fn(async (): Promise<void> => undefined);
	query = jest.fn(async (_sql: string): Promise<unknown> => undefined);
	end = jest.fn(async (): Promise<void> => undefined);
}
function fixture() {
	const clients = [new Client(), new Client(), new Client()];
	let next = 0;
	const factory = jest.fn(() => clients[next++]!);
	const wake = jest.fn();
	const change = jest.fn();
	const availability = jest.fn();
	const logger = { error: jest.fn() } as unknown as Logger;
	const listener = new ArchiveBrokerReadyListener(
		'private-test-only',
		wake,
		change,
		availability,
		logger,
		factory
	);
	return { clients, factory, wake, change, availability, listener };
}

describe('archive ready listener reconnect and invalidation', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());
	it('subscribes to both channels before advertising snapshot readiness', async () => {
		const test = fixture();
		const gate = deferred();
		test.clients[0]!.query.mockImplementation(() => gate.promise);
		const starting = test.listener.start();
		await Promise.resolve();
		expect(test.clients[0]!.query).toHaveBeenCalledWith(
			expect.stringContaining(`listen ${archiveBrokerRamNotificationChannel}`)
		);
		expect(test.availability).not.toHaveBeenCalled();
		gate.resolve();
		await starting;
		expect(test.availability).toHaveBeenLastCalledWith(true);
		expect(test.wake).toHaveBeenCalledTimes(1);
		await test.listener.close();
	});
	it('routes ID/context hints, resets malformed JSON and preserves legacy wakes', async () => {
		const test = fixture();
		await test.listener.start();
		const client = test.clients[0]!;
		client.emit('notification', {
			channel: archiveBrokerRamNotificationChannel,
			payload: '{"ids":["test"]}'
		});
		client.emit('notification', {
			channel: archiveBrokerRamNotificationChannel,
			payload: 'broken'
		});
		client.emit('notification', {
			channel: archiveBrokerRamNotificationChannel,
			payload: '{"context":true}'
		});
		client.emit('notification', {
			channel: historyArchiveReadyNotificationChannel,
			payload: 'ready'
		});
		client.emit('notification', { channel: 'unrelated', payload: '{}' });
		expect(test.change.mock.calls.map(([payload]) => payload)).toEqual([
			{ ids: ['test'] },
			{ reset: true },
			{ context: true }
		]);
		expect(test.wake).toHaveBeenCalledTimes(5);
		await test.listener.close();
	});
	it.each(['error', 'end'] as const)(
		'invalidates after %s and re-LISTENs before rebuilding',
		async (event) => {
			const test = fixture();
			await test.listener.start();
			test.clients[0]!.emit(event, new Error('connection lost'));
			expect(test.availability).toHaveBeenLastCalledWith(false);
			await jest.advanceTimersByTimeAsync(1_000);
			expect(test.factory).toHaveBeenCalledTimes(2);
			expect(test.clients[1]!.query).toHaveBeenCalledTimes(1);
			expect(test.availability).toHaveBeenLastCalledWith(true);
			test.clients[0]!.emit('notification', {
				channel: archiveBrokerRamNotificationChannel,
				payload: '{"reset":true}'
			});
			expect(test.change).not.toHaveBeenCalled();
			await test.listener.close();
		}
	);
	it('does not lose retry when the error arrives before connection settles', async () => {
		const test = fixture();
		const gate = deferred();
		test.clients[0]!.connect.mockImplementation(() => gate.promise);
		const starting = test.listener.start();
		test.clients[0]!.emit('error', new Error('connect pending'));
		await jest.advanceTimersByTimeAsync(1_000);
		expect(test.factory).toHaveBeenCalledTimes(1);
		gate.resolve();
		await starting;
		await jest.advanceTimersByTimeAsync(0);
		expect(test.factory).toHaveBeenCalledTimes(2);
		expect(test.availability).toHaveBeenLastCalledWith(true);
		await test.listener.close();
	});
	it('retries initial connection failure, and close cancels any future reconnect', async () => {
		const test = fixture();
		test.clients[0]!.connect.mockRejectedValueOnce(
			new Error('initial connection failed')
		);
		await test.listener.start();
		expect(test.availability).toHaveBeenLastCalledWith(false);
		await jest.advanceTimersByTimeAsync(1_000);
		expect(test.availability).toHaveBeenLastCalledWith(true);
		test.clients[1]!.emit('end');
		await test.listener.close();
		await jest.advanceTimersByTimeAsync(60_000);
		expect(test.factory).toHaveBeenCalledTimes(2);
		await test.listener.start();
		expect(test.factory).toHaveBeenCalledTimes(2);
	});
	it('drains in-progress initialization and never signals connected after close', async () => {
		const test = fixture();
		const gate = deferred();
		test.clients[0]!.query.mockImplementation(() => gate.promise);
		const starting = test.listener.start();
		await Promise.resolve();
		let closed = false;
		const closing = test.listener.close().then(() => {
			closed = true;
		});
		await Promise.resolve();
		expect(closed).toBe(false);
		gate.resolve();
		await starting;
		await closing;
		expect(test.availability.mock.calls).toEqual([[false]]);
		expect(test.wake).not.toHaveBeenCalled();
	});
});
