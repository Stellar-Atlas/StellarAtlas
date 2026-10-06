import { setImmediate } from 'node:timers/promises';
import type { Logger } from 'logger';
import { ArchiveBrokerAdaptiveMaintenance } from '../ArchiveBrokerAdaptiveMaintenance.js';
import { HistoryArchiveBrokerDispatcher } from '../HistoryArchiveBrokerDispatcher.js';
import type { HistoryArchiveBrokerConfig } from '../HistoryArchiveBrokerConfig.js';
import type {
	HistoryArchiveBrokerFrontierRepository,
	HistoryArchiveBrokerJob
} from '../../../repositories/database/HistoryArchiveBrokerFrontierRepository.js';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}
function fixture() {
	const gate = deferred<number>();
	const repository = { maintainAdaptiveProbes: jest.fn(() => gate.promise) };
	const logger = { error: jest.fn() };
	const wake = jest.fn();
	const maintenance = new ArchiveBrokerAdaptiveMaintenance(
		repository,
		logger,
		wake
	);
	return { gate, repository, logger, wake, maintenance };
}

describe('adaptive maintenance ownership', () => {
	it('shares one task and wakes only after committed admissions resolve', async () => {
		const test = fixture();
		const first = test.maintenance.run(120);
		expect(test.maintenance.run(8)).toBe(first);
		await setImmediate();
		expect(test.repository.maintainAdaptiveProbes).toHaveBeenCalledTimes(1);
		expect(test.repository.maintainAdaptiveProbes).toHaveBeenCalledWith(120);
		expect(test.wake).not.toHaveBeenCalled();
		test.gate.resolve(2);
		await expect(first).resolves.toBe(2);
		expect(test.wake).toHaveBeenCalledTimes(1);
		await test.maintenance.close();
	});
	it('does not wake for a committed no-op', async () => {
		const test = fixture();
		const pending = test.maintenance.run(120);
		test.gate.resolve(0);
		await expect(pending).resolves.toBe(0);
		expect(test.wake).not.toHaveBeenCalled();
		await test.maintenance.close();
	});
	it('handles rejected transactions without an unhandled rejection or wake', async () => {
		const test = fixture();
		const pending = test.maintenance.run(120);
		await setImmediate();
		test.gate.reject(new Error('transaction rolled back'));
		await expect(pending).resolves.toBe(0);
		expect(test.logger.error).toHaveBeenCalledTimes(1);
		expect(test.wake).not.toHaveBeenCalled();
		await test.maintenance.close();
	});
	it('drains the transaction and does not start work or wake after close', async () => {
		const test = fixture();
		const pending = test.maintenance.run(120);
		await setImmediate();
		let closed = false;
		const closing = test.maintenance.close().then(() => {
			closed = true;
		});
		await expect(test.maintenance.run(120)).resolves.toBe(0);
		expect(closed).toBe(false);
		test.gate.resolve(2);
		await closing;
		await expect(pending).resolves.toBe(2);
		expect(test.wake).not.toHaveBeenCalled();
		expect(test.repository.maintainAdaptiveProbes).toHaveBeenCalledTimes(1);
	});
	it('does not start a queued task after close', async () => {
		const test = fixture();
		const pending = test.maintenance.run(120);
		await test.maintenance.close();
		await expect(pending).resolves.toBe(0);
		expect(test.repository.maintainAdaptiveProbes).not.toHaveBeenCalled();
	});
});

function dispatcherFixture(emptyFirst: boolean, publishCount = 1) {
	const gate = deferred<number>();
	const fresh = [{ executionId: 'fresh' }] as HistoryArchiveBrokerJob[];
	const reserveJobs = jest.fn(async () => fresh);
	if (emptyFirst) reserveJobs.mockResolvedValueOnce([]);
	const repository = {
		maintainAdaptiveProbes: jest.fn(() => gate.promise),
		admitDailyTransientSourceRetries: jest.fn(async () => 0),
		reserveJobs,
		cleanupOrphanedCandidates: jest.fn(async () => undefined),
		ensurePrefetch: jest.fn(async () => 0),
		recoverMissingFrontierReady: jest.fn(async () => 0),
		ensureFrontier: jest.fn(async () => 0)
	};
	const logger = {
		error: jest.fn(),
		warn: jest.fn(),
		info: jest.fn(),
		debug: jest.fn()
	};
	const dispatcher = new HistoryArchiveBrokerDispatcher(
		repository as unknown as HistoryArchiveBrokerFrontierRepository,
		{
			highWatermark: 120,
			batchSize: 120,
			maximumPerHost: 8,
			maximumPriority: 2,
			canonicalFirstRoot: null
		} as HistoryArchiveBrokerConfig,
		logger as unknown as Logger
	);
	const runtime = dispatcher as unknown as {
		initialize(): Promise<void>;
		initializeReadyListener(): Promise<void>;
		getBrokerCapacity(): Promise<{ availableCapacity: number; empty: boolean }>;
		replayOrphanedPublishedJobs(): Promise<boolean>;
		publish(jobs: readonly HistoryArchiveBrokerJob[]): Promise<void>;
		waitForWork(version: number): Promise<void>;
		connection: { drain(): Promise<void> } | null;
		stopping: boolean;
	};
	runtime.initialize = async () => undefined;
	runtime.initializeReadyListener = async () => undefined;
	runtime.getBrokerCapacity = async () => ({
		availableCapacity: 120,
		empty: false
	});
	runtime.replayOrphanedPublishedJobs = async () => false;
	const published = jest.fn(async () => {
		if (published.mock.calls.length >= publishCount) runtime.stopping = true;
	});
	runtime.publish = published;
	const wait = jest.fn(async () => {
		runtime.stopping = true;
	});
	runtime.waitForWork = wait;
	const drain = jest.fn(async () => undefined);
	runtime.connection = { drain };
	return { gate, repository, logger, dispatcher, published, wait, drain };
}

describe('dispatcher adaptive maintenance sequencing', () => {
	it('publishes two fresh batches without awaiting or duplicating slow adaptive work', async () => {
		const test = dispatcherFixture(false, 2);
		await test.dispatcher.run();
		expect(test.published).toHaveBeenCalledTimes(2);
		expect(test.repository.maintainAdaptiveProbes).toHaveBeenCalledTimes(1);
		const closing = test.dispatcher.close();
		await setImmediate();
		expect(test.drain).not.toHaveBeenCalled();
		test.gate.resolve(1);
		await closing;
		expect(test.drain).toHaveBeenCalledTimes(1);
	});
	it('joins the same task after an empty result then reselects before legacy frontier work', async () => {
		const test = dispatcherFixture(true);
		const running = test.dispatcher.run();
		await setImmediate();
		expect(test.repository.reserveJobs).toHaveBeenCalledTimes(1);
		expect(test.published).not.toHaveBeenCalled();
		expect(test.repository.ensurePrefetch).not.toHaveBeenCalled();
		test.gate.resolve(1);
		await running;
		await test.dispatcher.close();
		expect(test.repository.reserveJobs).toHaveBeenCalledTimes(2);
		expect(test.repository.maintainAdaptiveProbes).toHaveBeenCalledTimes(1);
		expect(test.repository.ensurePrefetch).not.toHaveBeenCalled();
		expect(test.published).toHaveBeenCalledTimes(1);
	});
	it.each(['noop', 'rollback'])(
		'does not reselect or self-wake after %s',
		async (outcome) => {
			const test = dispatcherFixture(true);
			const running = test.dispatcher.run();
			await setImmediate();
			if (outcome === 'rollback')
				test.gate.reject(new Error('commit rejected'));
			else test.gate.resolve(0);
			await running;
			await test.dispatcher.close();
			expect(test.repository.reserveJobs).toHaveBeenCalledTimes(1);
			expect(test.repository.maintainAdaptiveProbes).toHaveBeenCalledTimes(1);
			expect(test.published).not.toHaveBeenCalled();
			expect(test.wait).toHaveBeenCalledTimes(1);
		}
	);
});
