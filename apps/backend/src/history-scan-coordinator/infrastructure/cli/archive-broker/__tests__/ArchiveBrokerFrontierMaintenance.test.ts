import { setImmediate } from 'node:timers/promises';
import type { Logger } from 'logger';
import {
	ArchiveBrokerFrontierMaintenance,
	shareArchiveBrokerClose
} from '../ArchiveBrokerFrontierMaintenance.js';
import { HistoryArchiveBrokerDispatcher } from '../HistoryArchiveBrokerDispatcher.js';
import type { HistoryArchiveBrokerConfig } from '../HistoryArchiveBrokerConfig.js';
import type {
	HistoryArchiveBrokerFrontierRepository,
	HistoryArchiveBrokerJob
} from '../../../repositories/database/HistoryArchiveBrokerFrontierRepository.js';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
const config = {
	highWatermark: 120,
	batchSize: 120,
	maximumPerHost: 8,
	maximumPriority: 2,
	canonicalFirstRoot: null
} as HistoryArchiveBrokerConfig;
const logger = () =>
	({
		error: jest.fn(),
		info: jest.fn(),
		warn: jest.fn(),
		debug: jest.fn()
	}) as unknown as Logger;

describe('single-flight optional archive frontier maintenance', () => {
	it('shares one sequence, handles completion and can run again on a later cadence', async () => {
		const gate = deferred();
		const repository = {
			ensurePrefetch: jest.fn(async () => {
				await gate.promise;
				return 0;
			}),
			recoverMissingFrontierReady: jest.fn(async () => 0)
		};
		const wake = jest.fn();
		const maintenance = new ArchiveBrokerFrontierMaintenance(
			repository,
			config,
			logger(),
			wake
		);
		const first = maintenance.run();
		expect(maintenance.run()).toBe(first);
		await setImmediate();
		expect(repository.ensurePrefetch).toHaveBeenCalledTimes(1);
		expect(repository.recoverMissingFrontierReady).not.toHaveBeenCalled();
		gate.resolve();
		await first;
		expect(repository.recoverMissingFrontierReady).toHaveBeenCalledTimes(1);
		expect(wake).toHaveBeenCalledTimes(1);
		await maintenance.run();
		expect(repository.ensurePrefetch).toHaveBeenCalledTimes(2);
	});
	it.each(['prefetch', 'recovery'])(
		'handles %s errors without rejecting a detached task',
		async (step) => {
			const log = logger();
			const repository = {
				ensurePrefetch: jest.fn(async () => {
					if (step === 'prefetch') throw new Error('prefetch unavailable');
					return 0;
				}),
				recoverMissingFrontierReady: jest.fn(async () => {
					if (step === 'recovery') throw new Error('recovery unavailable');
					return 0;
				})
			};
			const maintenance = new ArchiveBrokerFrontierMaintenance(
				repository,
				config,
				log,
				() => undefined
			);
			const pending = maintenance.run();
			await expect(pending).resolves.toBeUndefined();
			expect(log.error).toHaveBeenCalledTimes(1);
			await maintenance.close();
		}
	);
	it('closes by joining the active query and starts no recovery or wake after stopping', async () => {
		const gate = deferred();
		const repository = {
			ensurePrefetch: jest.fn(async () => {
				await gate.promise;
				return 0;
			}),
			recoverMissingFrontierReady: jest.fn(async () => 0)
		};
		const wake = jest.fn();
		const maintenance = new ArchiveBrokerFrontierMaintenance(
			repository,
			config,
			logger(),
			wake
		);
		void maintenance.run();
		await setImmediate();
		let closed = false;
		const closing = maintenance.close().then(() => {
			closed = true;
		});
		await maintenance.run();
		expect(closed).toBe(false);
		gate.resolve();
		await closing;
		expect(repository.ensurePrefetch).toHaveBeenCalledTimes(1);
		expect(repository.recoverMissingFrontierReady).not.toHaveBeenCalled();
		expect(wake).not.toHaveBeenCalled();
	});
	it('signal and finally share the same close promise before database destruction', async () => {
		const gate = deferred();
		let drained = false;
		const drain = jest.fn(async () => {
			await gate.promise;
			drained = true;
		});
		const close = shareArchiveBrokerClose(drain);
		const signalClose = close();
		const finallyClose = close();
		expect(signalClose).toBe(finallyClose);
		await setImmediate();
		expect(drained).toBe(false);
		gate.resolve();
		await finallyClose;
		expect(drained).toBe(true);
		expect(drain).toHaveBeenCalledTimes(1);
	});
});

describe('dispatcher refill while optional maintenance is slow', () => {
	function fixture(emptyFirst: boolean) {
		const gate = deferred();
		const events: string[] = [];
		const fresh = [{ executionId: 'fresh' }] as HistoryArchiveBrokerJob[];
		const reserveJobs = jest.fn(async () => {
			events.push('reserve');
			return fresh;
		});
		if (emptyFirst) reserveJobs.mockResolvedValueOnce([]);
		const repository = {
			ensurePrefetch: jest.fn(async () => {
				events.push('maintenance');
				await gate.promise;
				return 0;
			}),
			recoverMissingFrontierReady: jest.fn(async () => 0),
			requeueOrphanedPublishedJobs: jest.fn(async () => {
				events.push('empty-stream-cleanup');
				return 0;
			}),
			findPublishedJobs: jest.fn(async () => []),
			admitDailyTransientSourceRetries: jest.fn(async () => 0),
			reserveJobs,
			ensureFrontier: jest.fn(async () => 0)
		};
		const dispatcher = new HistoryArchiveBrokerDispatcher(
			repository as unknown as HistoryArchiveBrokerFrontierRepository,
			config,
			logger()
		);
		const runtime = dispatcher as unknown as {
			initialize(): Promise<void>;
			initializeReadyListener(): Promise<void>;
			getAvailableCapacity(): Promise<number>;
			publish(jobs: readonly HistoryArchiveBrokerJob[]): Promise<void>;
			stopping: boolean;
			connection: { drain(): Promise<void> } | null;
		};
		runtime.initialize = async () => undefined;
		runtime.initializeReadyListener = async () => undefined;
		runtime.getAvailableCapacity = async () => 120;
		const drain = jest.fn(async () => {
			events.push('nats-drain');
		});
		runtime.connection = { drain };
		runtime.publish = async () => {
			events.push('publish');
			runtime.stopping = true;
		};
		return { gate, events, repository, dispatcher, drain };
	}
	it('publishes fresh work before delayed maintenance finishes, retaining synchronous empty-NATS cleanup', async () => {
		const test = fixture(false);
		await test.dispatcher.run();
		expect(test.events).toContain('publish');
		expect(test.events.indexOf('empty-stream-cleanup')).toBeLessThan(
			test.events.indexOf('publish')
		);
		expect(test.repository.ensurePrefetch).toHaveBeenCalledTimes(1);
		const closing = test.dispatcher.close();
		await setImmediate();
		expect(test.drain).not.toHaveBeenCalled();
		test.gate.resolve();
		await closing;
		expect(test.drain).toHaveBeenCalledTimes(1);
		expect(test.events.at(-1)).toBe('nats-drain');
	});
	it('joins the same pending sequence only when the fresh reservation is empty', async () => {
		const test = fixture(true);
		const running = test.dispatcher.run();
		await setImmediate();
		expect(test.repository.reserveJobs).toHaveBeenCalledTimes(1);
		expect(test.events).not.toContain('publish');
		expect(test.repository.ensurePrefetch).toHaveBeenCalledTimes(1);
		test.gate.resolve();
		await running;
		await test.dispatcher.close();
		expect(test.events).toContain('publish');
		expect(test.repository.ensurePrefetch).toHaveBeenCalledTimes(1);
		expect(test.repository.recoverMissingFrontierReady).toHaveBeenCalledTimes(
			1
		);
	});
});
