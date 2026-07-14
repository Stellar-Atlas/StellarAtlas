import type { FullHistoryOperationWorkerMetrics } from '../WorkerThreadFullHistoryCheckpointDecoder.js';
import {
	runContinuousFullHistoryOperationBackfillLoop,
	type ContinuousFullHistoryOperationBackfillCycleResult,
	type ContinuousFullHistoryOperationBackfillLoopConfig,
	type ContinuousFullHistoryOperationBackfillLoopEvent
} from '../ContinuousFullHistoryOperationBackfillLoop.js';

const config: ContinuousFullHistoryOperationBackfillLoopConfig = {
	batchLimit: 12,
	cpuWorkerCount: 12,
	errorBackoffMs: 30_000,
	heartbeatIntervalMs: 60_000,
	idleBackoffMs: 15_000,
	leadershipBackoffMs: 45_000,
	successDelayMs: 250
};

describe('continuous full-history operation backfill loop', () => {
	it('serializes bounded cycles and applies outcome-specific delays', async () => {
		const results: readonly ContinuousFullHistoryOperationBackfillCycleResult[] =
			[
				executed('completed', 12),
				executed('idle', 0),
				{ status: 'leadership-unavailable' }
			];
		const events: ContinuousFullHistoryOperationBackfillLoopEvent[] = [];
		const waits: number[] = [];
		let active = 0;
		let index = 0;
		let maximumActive = 0;
		let stopped = false;

		await runContinuousFullHistoryOperationBackfillLoop(config, {
			describeFailure: (error) => ({ message: String(error) }),
			emit: (event) => events.push(event),
			executeCycle: async () => {
				active += 1;
				maximumActive = Math.max(maximumActive, active);
				await Promise.resolve();
				const result = results[index];
				if (result === undefined) throw new Error('Unexpected extra cycle');
				index += 1;
				active -= 1;
				return result;
			},
			now: () => 1_000,
			scheduleHeartbeat: () => () => undefined,
			shouldStop: () => stopped,
			wait: async (milliseconds) => {
				waits.push(milliseconds);
				if (waits.length === results.length) stopped = true;
			}
		});

		expect(maximumActive).toBe(1);
		expect(waits).toEqual([250, 15_000, 45_000]);
		expect(
			events
				.filter((event) => event.event === 'cycle-outcome')
				.map((event) => event.status)
		).toEqual(['completed', 'idle', 'leadership-unavailable']);
		const completed = events.find(
			(event) => event.event === 'cycle-outcome' && event.status === 'completed'
		);
		expect(completed).toMatchObject({
			completedBatches: 12,
			cpuWorkers: 12,
			peakActiveBatches: 12,
			selectedWindowFull: true
		});
	});

	it('backs off after failure and reports bounded worker evidence', async () => {
		const events: ContinuousFullHistoryOperationBackfillLoopEvent[] = [];
		let stopped = false;
		const metrics = workerMetrics({ failedTasks: 1 });

		await runContinuousFullHistoryOperationBackfillLoop(config, {
			describeFailure: () => ({
				message: 'worker temporarily failed',
				workerMetrics: metrics
			}),
			emit: (event) => events.push(event),
			executeCycle: async () => {
				throw new Error('decode failed');
			},
			now: () => 2_000,
			scheduleHeartbeat: () => () => undefined,
			shouldStop: () => stopped,
			wait: async (milliseconds) => {
				expect(milliseconds).toBe(30_000);
				stopped = true;
			}
		});

		expect(events).toContainEqual(
			expect.objectContaining({
				event: 'cycle-error',
				message: 'worker temporarily failed',
				retryInMs: 30_000,
				workerMetrics: metrics
			})
		);
	});

	it('emits stopping heartbeats while an in-flight cycle drains', async () => {
		const cycle = deferred<ContinuousFullHistoryOperationBackfillCycleResult>();
		const events: ContinuousFullHistoryOperationBackfillLoopEvent[] = [];
		let heartbeat: (() => void) | null = null;
		let stopped = false;
		const cancelHeartbeat = jest.fn();
		const executeCycle = jest.fn(() => cycle.promise);

		const running = runContinuousFullHistoryOperationBackfillLoop(config, {
			describeFailure: (error) => ({ message: String(error) }),
			emit: (event) => events.push(event),
			executeCycle,
			now: () => 3_000,
			scheduleHeartbeat: (emit) => {
				heartbeat = emit;
				return cancelHeartbeat;
			},
			shouldStop: () => stopped,
			wait: async () => undefined
		});
		await Promise.resolve();
		stopped = true;
		heartbeat?.();
		cycle.resolve(executed('idle', 0));
		await running;

		expect(executeCycle).toHaveBeenCalledTimes(1);
		expect(cancelHeartbeat).toHaveBeenCalledTimes(1);
		expect(events).toContainEqual(
			expect.objectContaining({
				activeCycles: 1,
				event: 'heartbeat',
				phase: 'executing',
				status: 'stopping'
			})
		);
	});

	it('includes cumulative operation and account-reference counts in heartbeats', async () => {
		const events: ContinuousFullHistoryOperationBackfillLoopEvent[] = [];
		let heartbeat: (() => void) | null = null;
		let stopped = false;

		await runContinuousFullHistoryOperationBackfillLoop(config, {
			describeFailure: (error) => ({ message: String(error) }),
			emit: (event) => events.push(event),
			executeCycle: async () => executed('completed', 2),
			now: () => 4_000,
			scheduleHeartbeat: (emit) => {
				heartbeat = emit;
				return () => undefined;
			},
			shouldStop: () => stopped,
			wait: async () => {
				heartbeat?.();
				stopped = true;
			}
		});

		const heartbeats = events.filter((event) => event.event === 'heartbeat');
		expect(heartbeats.at(-1)).toMatchObject({
			totals: {
				accountReferenceFacts: 4,
				completedBatches: 2,
				failedCycles: 0,
				operationFacts: 2
			}
		});
	});
});

function executed(
	status: 'completed' | 'idle',
	completedBatches: number
): ContinuousFullHistoryOperationBackfillCycleResult {
	return {
		execution: {
			accountReferenceFacts: completedBatches * 2,
			batchLimit: 12,
			completedBatches,
			cpuWorkers: 12,
			operationFacts: completedBatches,
			peakActiveBatches: completedBatches,
			receipts: Array.from({ length: completedBatches }, (_, index) => ({
				accountReferenceCount: 2,
				batchId: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
				operationCount: 1,
				replayed: false
			})),
			selectedBatches: completedBatches,
			status,
			workerMetrics: workerMetrics({
				completedTasks: completedBatches,
				peakActiveWorkers: completedBatches
			})
		},
		status: 'executed'
	};
}

function workerMetrics(
	overrides: Partial<FullHistoryOperationWorkerMetrics> = {}
): FullHistoryOperationWorkerMetrics {
	return {
		activeWorkers: 0,
		completedTasks: 0,
		failedTasks: 0,
		peakActiveWorkers: 0,
		peakArrayBuffersBytes: 1,
		peakExternalBytes: 1,
		peakHeapUsedBytes: 1,
		queuedTasks: 0,
		resourceLimitMb: 2_048,
		retryCount: 0,
		workerCapacity: 12,
		...overrides
	};
}

function deferred<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
} {
	let resolvePromise: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve: (value) => {
			if (resolvePromise === undefined)
				throw new Error('Deferred not initialized');
			resolvePromise(value);
		}
	};
}
