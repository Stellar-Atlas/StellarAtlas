import { setImmediate } from 'node:timers/promises';
import type { Logger } from 'logger';
import type { ArchiveBrokerOccupancy } from '../ArchiveBrokerConsumerHealth.js';
import {
	calculateHistoryArchiveBrokerAvailableCapacity,
	getArchiveBrokerCapacity
} from '../ArchiveBrokerBuffer.js';
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
	pollIntervalMs: 2000,
	stream: 'jobs',
	consumer: 'workers',
	subject: 'jobs.work'
} as HistoryArchiveBrokerConfig;
function occupancy(
	ack: number,
	pending: number,
	messages = ack + pending,
	inconsistent = false
): ArchiveBrokerOccupancy {
	return {
		consumer: {
			num_ack_pending: ack,
			num_pending: pending,
			delivered: { stream_seq: 10 }
		},
		stream: { state: { messages, last_seq: inconsistent ? 9 : 10 } },
		inconsistent
	};
}
function fixture(initial: ArchiveBrokerOccupancy, batchSize = 120) {
	let snapshot = initial;
	const repository = {
		ensurePrefetch: jest.fn(async () => 0),
		recoverMissingFrontierReady: jest.fn(async () => 0),
		requeueOrphanedPublishedJobs: jest.fn(async () => 0),
		findPublishedJobs: jest.fn(async () => []),
		reconcilePhaseSuppressedPublishedJobs: jest.fn(async () => 0),
		admitDailyTransientSourceRetries: jest.fn(async () => 0),
		reserveJobs: jest.fn<
			Promise<readonly HistoryArchiveBrokerJob[]>,
			[number, number, number, string | null]
		>(async () => []),
		ensureFrontier: jest.fn(async () => 0)
	};
	const logger = {
		error: jest.fn(),
		info: jest.fn(),
		warn: jest.fn(),
		debug: jest.fn()
	} as unknown as Logger;
	const dispatcher = new HistoryArchiveBrokerDispatcher(
		repository as unknown as HistoryArchiveBrokerFrontierRepository,
		{ ...config, batchSize },
		logger
	);
	const runtime = dispatcher as unknown as {
		initialize(): Promise<void>;
		initializeReadyListener(): Promise<void>;
		getBrokerCapacity(): Promise<ReturnType<typeof getArchiveBrokerCapacity>>;
		publish(jobs: readonly HistoryArchiveBrokerJob[]): Promise<void>;
		ensureConsumer(manager: unknown): Promise<void>;
		ensureStream(manager: unknown): Promise<boolean>;
	};
	runtime.initialize = async () => undefined;
	runtime.initializeReadyListener = async () => undefined;
	runtime.getBrokerCapacity = async () =>
		getArchiveBrokerCapacity(120, snapshot);
	const publish = jest.fn(async (jobs: readonly HistoryArchiveBrokerJob[]) => {
		snapshot = occupancy(
			snapshot.consumer.num_ack_pending,
			snapshot.consumer.num_pending + jobs.length,
			snapshot.stream.state.messages + jobs.length
		);
	});
	runtime.publish = publish;
	return { repository, dispatcher, runtime, publish };
}
const jobs = (count: number) =>
	Array.from({ length: count }, (_, i) => ({
		executionId: String(i)
	})) as HistoryArchiveBrokerJob[];

describe('derived broker prebuffer', () => {
	it.each([
		[120, 120, 240, 0],
		[119, 120, 239, 0],
		[120, 61, 181, 0],
		[120, 60, 180, 60],
		[120, 0, 120, 120],
		[0, 0, 0, 240],
		[0, 0, 240, 0],
		[120, 60, 200, 0],
		[120, 60, 100, 60]
	])(
		'ack=%i pending=%i stream=%i offers capacity=%i',
		(ack, pending, stream, expected) => {
			expect(
				calculateHistoryArchiveBrokerAvailableCapacity(
					120,
					ack,
					pending,
					stream
				)
			).toBe(expected);
		}
	);
	it.each([
		[1, 0, 2],
		[1, 1, 1],
		[1, 2, 0],
		[3, 4, 2],
		[3, 5, 0]
	])(
		'uses the same derived boundaries for W=%i occupied=%i',
		(workers, occupied, expected) => {
			expect(
				calculateHistoryArchiveBrokerAvailableCapacity(
					workers,
					occupied,
					0,
					occupied
				)
			).toBe(expected);
		}
	);
	it.each([
		occupancy(120, 0),
		occupancy(0, 1),
		occupancy(0, 0, 1),
		occupancy(0, 0, 0, true)
	])(
		'never treats capacity, retained messages or an inconsistent snapshot as empty',
		(snapshot) => {
			expect(getArchiveBrokerCapacity(120, snapshot).empty).toBe(false);
		}
	);
	it('fails closed on inconsistent or malformed occupancy', () => {
		expect(
			getArchiveBrokerCapacity(120, occupancy(0, 0, 0, true)).availableCapacity
		).toBe(0);
		for (const count of [NaN, Infinity, -1, 0.5])
			expect(
				calculateHistoryArchiveBrokerAvailableCapacity(120, count, 0, 0)
			).toBe(0);
	});
	it('keeps consumer execution concurrency W and stream retention 2W', async () => {
		const test = fixture(occupancy(0, 0));
		const manager = {
			consumers: { info: jest.fn(async () => ({})), update: jest.fn() },
			streams: { info: jest.fn(async () => ({})), update: jest.fn() }
		};
		await test.runtime.ensureConsumer(manager);
		await test.runtime.ensureStream(manager);
		expect(manager.consumers.update).toHaveBeenCalledWith(
			'jobs',
			'workers',
			expect.objectContaining({ max_ack_pending: 120 })
		);
		expect(manager.streams.update).toHaveBeenCalledWith(
			'jobs',
			expect.objectContaining({ max_msgs: 240 })
		);
		await test.dispatcher.close();
	});
});

describe('buffered dispatcher refill and orphan fencing', () => {
	beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate'] }));
	afterEach(() => jest.useRealTimers());
	it('fills an empty broker in existing W-sized batches and then stops querying', async () => {
		const test = fixture(occupancy(0, 0));
		test.repository.reserveJobs.mockResolvedValue(jobs(120));
		const running = test.dispatcher.run();
		await setImmediate();
		expect(test.repository.reserveJobs).toHaveBeenCalledTimes(2);
		expect(
			test.repository.reserveJobs.mock.calls.map((call) => call.slice(0, 2))
		).toEqual([
			[120, 8],
			[120, 8]
		]);
		expect(test.publish).toHaveBeenCalledTimes(2);
		expect(test.repository.requeueOrphanedPublishedJobs).toHaveBeenCalledTimes(
			1
		);
		await test.dispatcher.close();
		await running;
	});
	it('buffers behind 120 live jobs without invalidating any published token', async () => {
		const test = fixture(occupancy(120, 0));
		test.repository.reserveJobs.mockResolvedValue(jobs(120));
		const running = test.dispatcher.run();
		await setImmediate();
		expect(test.repository.reserveJobs).toHaveBeenCalledTimes(1);
		expect(test.repository.requeueOrphanedPublishedJobs).not.toHaveBeenCalled();
		await test.dispatcher.close();
		await running;
	});
	it.each([occupancy(0, 0, 1), occupancy(0, 1, 1), occupancy(0, 0, 0, true)])(
		'never performs empty-broker cleanup on retained/pending/inconsistent state',
		async (snapshot) => {
			const test = fixture(snapshot);
			const running = test.dispatcher.run();
			await setImmediate();
			expect(
				test.repository.requeueOrphanedPublishedJobs
			).not.toHaveBeenCalled();
			if (snapshot.inconsistent)
				expect(test.repository.reserveJobs).not.toHaveBeenCalled();
			await test.dispatcher.close();
			await running;
		}
	);
	it('refills only the remaining60 at the low boundary and honors a smaller existing batch', async () => {
		const test = fixture(occupancy(120, 60), 20);
		test.repository.reserveJobs.mockResolvedValue(jobs(20));
		const running = test.dispatcher.run();
		await setImmediate();
		expect(test.repository.reserveJobs).toHaveBeenCalledTimes(1);
		expect(test.repository.reserveJobs).toHaveBeenCalledWith(20, 8, 2, null);
		await test.dispatcher.close();
		await running;
	});
	it('does not spin after a partial fill when remaining eligible work is absent', async () => {
		const test = fixture(occupancy(120, 0));
		test.repository.reserveJobs.mockResolvedValueOnce(jobs(8));
		const running = test.dispatcher.run();
		await setImmediate();
		expect(test.repository.reserveJobs).toHaveBeenCalledTimes(2);
		await jest.advanceTimersByTimeAsync(1999);
		expect(test.repository.reserveJobs).toHaveBeenCalledTimes(2);
		await test.dispatcher.close();
		await running;
	});
});
