import { setImmediate } from 'node:timers/promises';
import type { Logger } from 'logger';
import { ArchiveBrokerFrontierMaintenance } from '../ArchiveBrokerFrontierMaintenance.js';
import { HistoryArchiveBrokerDispatcher } from '../HistoryArchiveBrokerDispatcher.js';
import type { HistoryArchiveBrokerConfig } from '../HistoryArchiveBrokerConfig.js';
import type {
	HistoryArchiveBrokerFrontierRepository,
	HistoryArchiveBrokerJob
} from '../../../repositories/database/HistoryArchiveBrokerFrontierRepository.js';

const config = {
	highWatermark: 120,
	batchSize: 120,
	maximumPerHost: 8,
	maximumPriority: 2,
	canonicalFirstRoot: null,
	pollIntervalMs: 2000
} as HistoryArchiveBrokerConfig;
const logger = {
	error: jest.fn(),
	info: jest.fn(),
	warn: jest.fn(),
	debug: jest.fn()
} as unknown as Logger;
const fresh = [{ executionId: 'fresh' }] as HistoryArchiveBrokerJob[];
function fixture(canonicalFirstRoot: string | null = null) {
	const repository = {
		cleanupOrphanedCandidates: jest.fn(async () => undefined),
		ensurePrefetch: jest.fn(async () => 0),
		recoverMissingFrontierReady: jest.fn(async () => 0),
		requeueOrphanedPublishedJobs: jest.fn(async () => 0),
		findPublishedJobs: jest.fn(async () => []),
		reconcilePhaseSuppressedPublishedJobs: jest.fn(async () => 0),
		admitDailyTransientSourceRetries: jest.fn(async () => 0),
		maintainAdaptiveProbes: jest.fn(async () => 0),
		reserveJobs: jest.fn<
			Promise<readonly HistoryArchiveBrokerJob[]>,
			[number, number, number, string | null]
		>(async () => []),
		ensureFrontier: jest.fn(async () => 0)
	};
	const dispatcher = new HistoryArchiveBrokerDispatcher(
		repository as unknown as HistoryArchiveBrokerFrontierRepository,
		{ ...config, canonicalFirstRoot },
		logger
	);
	const runtime = dispatcher as unknown as {
		initialize(): Promise<void>;
		initializeReadyListener(): Promise<void>;
		getBrokerCapacity(): Promise<{ availableCapacity: number; empty: boolean }>;
		signalWork(): void;
		waitForWork(version: number): Promise<void>;
		publish(jobs: readonly HistoryArchiveBrokerJob[]): Promise<void>;
		stopping: boolean;
	};
	runtime.initialize = async () => undefined;
	runtime.initializeReadyListener = async () => undefined;
	runtime.getBrokerCapacity = async () => ({
		availableCapacity: 120,
		empty: true
	});
	const publish = jest.fn(async () => {
		runtime.stopping = true;
	});
	runtime.publish = publish;
	return { repository, dispatcher, runtime, publish };
}

describe('event-driven empty broker recovery', () => {
	beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate'] }));
	afterEach(() => jest.useRealTimers());
	it('does one reservation for a no-op recovery cycle, then waits for the existing poll', async () => {
		const test = fixture();
		const running = test.dispatcher.run();
		await setImmediate();
		expect(test.repository.reserveJobs).toHaveBeenCalledTimes(1);
		expect(test.repository.ensureFrontier).toHaveBeenCalledTimes(1);
		await jest.advanceTimersByTimeAsync(1999);
		expect(test.repository.reserveJobs).toHaveBeenCalledTimes(1);
		await jest.advanceTimersByTimeAsync(1);
		expect(test.repository.reserveJobs).toHaveBeenCalledTimes(2);
		await test.dispatcher.close();
		await running;
	});
	it('handles a capacity/ready event immediately without waiting for the recovery poll', async () => {
		const test = fixture();
		const running = test.dispatcher.run();
		await setImmediate();
		test.repository.reserveJobs.mockResolvedValueOnce(fresh);
		test.runtime.signalWork();
		await running;
		expect(test.publish).toHaveBeenCalledTimes(1);
		expect(test.repository.reserveJobs).toHaveBeenCalledTimes(2);
		await test.dispatcher.close();
	});
	it('does not lose an external wake arriving during an empty reservation', async () => {
		const test = fixture();
		test.repository.reserveJobs
			.mockImplementationOnce(async () => {
				test.runtime.signalWork();
				return [];
			})
			.mockResolvedValueOnce(fresh);
		await test.dispatcher.run();
		expect(test.publish).toHaveBeenCalledTimes(1);
		expect(test.repository.reserveJobs).toHaveBeenCalledTimes(2);
		await test.dispatcher.close();
	});
	it('does not lose an external wake while joining slow maintenance', async () => {
		const test = fixture();
		let release!: (count: number) => void;
		test.repository.ensurePrefetch.mockReturnValueOnce(
			new Promise<number>((resolve) => {
				release = resolve;
			})
		);
		test.repository.reserveJobs
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(fresh);
		const running = test.dispatcher.run();
		await setImmediate();
		expect(test.repository.reserveJobs).toHaveBeenCalledTimes(1);
		test.runtime.signalWork();
		release(0);
		await running;
		expect(test.publish).toHaveBeenCalledTimes(1);
		await test.dispatcher.close();
	});
	it('reserves again after an actual ready change even if the notification is lost', async () => {
		const test = fixture();
		test.repository.ensureFrontier.mockResolvedValueOnce(1);
		test.repository.reserveJobs
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(fresh);
		await test.dispatcher.run();
		expect(test.repository.reserveJobs).toHaveBeenCalledTimes(2);
		expect(test.publish).toHaveBeenCalledTimes(1);
		await test.dispatcher.close();
	});
	it('keeps an already-ready canonical reservation ahead of broader work', async () => {
		const test = fixture('https://canonical.example');
		test.repository.reserveJobs.mockResolvedValueOnce(fresh);
		await test.dispatcher.run();
		expect(test.repository.reserveJobs.mock.calls.map((call) => call[3]))
			.toEqual(['https://canonical.example']);
		expect(test.publish).toHaveBeenCalledTimes(1);
		await test.dispatcher.close();
	});
	it('publishes already-ready broader work before optional canonical maintenance settles', async () => {
		const test = fixture('https://canonical.example');
		const feedback = jest.fn();
		Object.assign(test.runtime, { ram: {
			reserve: jest.fn(async () => null), recordBroaderFallbackResult: feedback,
			isCapacityFallbackActive: jest.fn(() => false),
			stopAdmission: jest.fn(), close: jest.fn(async () => undefined)
		} });
		let release!: (count: number) => void;
		const maintenance = new Promise<number>((resolve) => { release = resolve; });
		test.repository.ensurePrefetch.mockReturnValueOnce(maintenance);
		test.repository.maintainAdaptiveProbes.mockReturnValueOnce(maintenance);
		test.repository.reserveJobs.mockImplementation(
			async (_limit, _host, _priority, root) => (root === null ? fresh : [])
		);
		await test.dispatcher.run();
		expect(
			test.repository.reserveJobs.mock.calls.map((call) => call[3])
		).toEqual(['https://canonical.example', null]);
		expect(test.publish).toHaveBeenCalledTimes(1);
		expect(feedback.mock.calls).toEqual([[fresh.length]]);
		expect(test.repository.ensureFrontier).not.toHaveBeenCalled();
		expect(test.repository.ensurePrefetch).toHaveBeenCalledWith('https://canonical.example');
		let drained = false;
		const closing = test.dispatcher.close().then(() => { drained = true; });
		await setImmediate();
		expect(drained).toBe(false);
		release(0);
		await closing;
		expect(drained).toBe(true);
	});
	it('joins existing maintenance and reselects canonical work when both initial scopes are empty', async () => {
		const test = fixture('https://canonical.example');
		Object.assign(test.runtime, { ram: {
			reserve: jest.fn(async () => null), isCapacityFallbackActive: jest.fn(() => true),
			recordBroaderFallbackResult: jest.fn(), stopAdmission: jest.fn(), close: jest.fn(async () => undefined)
		} });
		let release!: (count: number) => void;
		test.repository.ensurePrefetch.mockReturnValueOnce(new Promise<number>((resolve) => { release = resolve; }));
		test.repository.reserveJobs.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce(fresh);
		const running = test.dispatcher.run();
		await setImmediate();
		expect(test.repository.reserveJobs.mock.calls.map((call) => call[3]))
			.toEqual(['https://canonical.example', null]);
		expect(test.publish).not.toHaveBeenCalled();
		release(1);
		await running;
		expect(test.repository.reserveJobs.mock.calls.map((call) => call[3]))
			.toEqual(['https://canonical.example', null, 'https://canonical.example']);
		expect(test.repository.ensurePrefetch).toHaveBeenCalledTimes(1);
		expect(test.repository.recoverMissingFrontierReady).toHaveBeenCalledTimes(1);
		expect(test.publish).toHaveBeenCalledTimes(1);
		await test.dispatcher.close();
	});
	it('waits for the existing poll instead of joining maintenance on a throttle-only empty wake', async () => {
		const test = fixture('https://canonical.example');
		Object.assign(test.runtime, { ram: {
			reserve: jest.fn(async () => []), isCapacityFallbackActive: jest.fn(() => true),
			recordBroaderFallbackResult: jest.fn(), stopAdmission: jest.fn(), close: jest.fn(async () => undefined)
		} });
		let release!: (count: number) => void;
		const maintenance = new Promise<number>((resolve) => { release = resolve; });
		test.repository.ensurePrefetch.mockReturnValueOnce(maintenance);
		test.repository.maintainAdaptiveProbes.mockReturnValueOnce(maintenance);
		const wait = jest.fn(async () => { test.runtime.stopping = true; });
		test.runtime.waitForWork = wait;
		await test.dispatcher.run();
		expect(wait).toHaveBeenCalledTimes(1);
		expect(test.repository.reserveJobs).not.toHaveBeenCalled();
		expect(test.repository.ensureFrontier).not.toHaveBeenCalled();
		expect(test.publish).not.toHaveBeenCalled();
		release(0);
		await test.dispatcher.close();
	});
});

describe('maintenance work notifications', () => {
	it('returns one shared count and wakes for committed prefetch even when recovery fails', async () => {
		const wake = jest.fn();
		const maintenance = new ArchiveBrokerFrontierMaintenance(
			{
				cleanupOrphanedCandidates: jest.fn(async () => undefined),
				ensurePrefetch: async () => 3,
				recoverMissingFrontierReady: async () => {
					throw new Error('recovery timeout');
				}
			},
			config,
			logger,
			wake
		);
		const first = maintenance.run();
		expect(maintenance.run()).toBe(first);
		await expect(first).resolves.toBe(3);
		expect(wake).toHaveBeenCalledTimes(1);
		await maintenance.close();
	});
	it('sums committed ready changes and never wakes for an error before any change', async () => {
		const wake = jest.fn();
		const maintenance = new ArchiveBrokerFrontierMaintenance(
			{
				cleanupOrphanedCandidates: jest.fn(async () => undefined),
				ensurePrefetch: async () => 2,
				recoverMissingFrontierReady: async () => 4
			},
			config,
			logger,
			wake
		);
		await expect(maintenance.run()).resolves.toBe(6);
		expect(wake).toHaveBeenCalledTimes(1);
		await maintenance.close();
		const failureWake = jest.fn();
		const failed = new ArchiveBrokerFrontierMaintenance(
			{
				cleanupOrphanedCandidates: jest.fn(async () => undefined),
				ensurePrefetch: async () => {
					throw new Error('no commit');
				},
				recoverMissingFrontierReady: async () => 1
			},
			config,
			logger,
			failureWake
		);
		await expect(failed.run()).resolves.toBe(0);
		expect(failureWake).not.toHaveBeenCalled();
		await failed.close();
	});
});
