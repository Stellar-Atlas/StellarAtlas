import type { DataSource } from 'typeorm';
import { mock } from 'jest-mock-extended';
import {
	createContinuousFullHistoryOperationBackfillCycleExecutor,
	parseContinuousFullHistoryOperationBackfillConfig,
	runContinuousFullHistoryOperationBackfillCli,
	type ContinuousFullHistoryOperationBackfillCliDependencies
} from '../ContinuousFullHistoryOperationBackfillCli.js';
import type { FullHistoryOperationBackfillLeadershipLease } from '../FullHistoryOperationBackfillLeadership.js';
import type { FullHistoryOperationWorkerMetrics } from '../WorkerThreadFullHistoryCheckpointDecoder.js';

const enabledEnvironment = {
	FULL_HISTORY_CONTINUOUS_OPERATION_BACKFILL_ENABLED: 'true',
	FULL_HISTORY_NETWORK_PASSPHRASE: 'Continuous operation fixture network'
};

describe('continuous full-history operation backfill CLI', () => {
	it('uses autonomous 12-worker and bounded batch defaults without operator confirmation', () => {
		expect(
			parseContinuousFullHistoryOperationBackfillConfig(enabledEnvironment)
		).toMatchObject({
			batchLimit: 12,
			cpuWorkerCount: 12,
			errorBackoffMs: 30_000,
			idleBackoffMs: 15_000,
			leadershipBackoffMs: 30_000,
			successDelayMs: 250
		});
	});

	it('requires continuous enablement and enforces the total worker cap', () => {
		expect(() =>
			parseContinuousFullHistoryOperationBackfillConfig({
				FULL_HISTORY_NETWORK_PASSPHRASE: 'fixture'
			})
		).toThrow('FULL_HISTORY_CONTINUOUS_OPERATION_BACKFILL_ENABLED');
		expect(() =>
			parseContinuousFullHistoryOperationBackfillConfig({
				...enabledEnvironment,
				FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS: '13'
			})
		).toThrow('between 1 and 12');
		expect(() =>
			parseContinuousFullHistoryOperationBackfillConfig({
				...enabledEnvironment,
				FULL_HISTORY_OPERATION_BACKFILL_BATCHES: '25'
			})
		).toThrow('between 1 and 24');
	});

	it('runs each invocation under the existing advisory lock and releases it', async () => {
		const dataSource = mock<DataSource>();
		const order: string[] = [];
		const release = jest.fn(async () => {
			order.push('release');
		});
		const acquireLeadership = jest.fn(async () => {
			order.push('acquire');
			return { acquired: true, release };
		});
		const execute = jest.fn(async () => {
			order.push('execute');
			return executionResult('idle');
		});
		const runCycle = createContinuousFullHistoryOperationBackfillCycleExecutor(
			dataSource,
			parseContinuousFullHistoryOperationBackfillConfig(enabledEnvironment),
			{ acquireLeadership, execute }
		);

		await expect(runCycle()).resolves.toMatchObject({
			execution: { status: 'idle' },
			status: 'executed'
		});
		expect(order).toEqual(['acquire', 'execute', 'release']);
		expect(execute).toHaveBeenCalledWith(dataSource, {
			batchLimit: 12,
			cpuWorkerCount: 12,
			networkPassphrase: 'Continuous operation fixture network'
		});
	});

	it('does not execute when leadership is unavailable and closes the lease', async () => {
		const dataSource = mock<DataSource>();
		const release = jest.fn().mockResolvedValue(undefined);
		const execute = jest.fn().mockResolvedValue(executionResult('idle'));
		const runCycle = createContinuousFullHistoryOperationBackfillCycleExecutor(
			dataSource,
			parseContinuousFullHistoryOperationBackfillConfig(enabledEnvironment),
			{
				acquireLeadership: async () => ({ acquired: false, release }),
				execute
			}
		);

		await expect(runCycle()).resolves.toEqual({
			status: 'leadership-unavailable'
		});
		expect(execute).not.toHaveBeenCalled();
		expect(release).toHaveBeenCalledTimes(1);
	});

	it('rejects an accidental overlapping cycle before acquiring another lock', async () => {
		const dataSource = mock<DataSource>();
		const leadership = deferred<FullHistoryOperationBackfillLeadershipLease>();
		const acquireLeadership = jest.fn(() => leadership.promise);
		const execute = jest.fn().mockResolvedValue(executionResult('idle'));
		const runCycle = createContinuousFullHistoryOperationBackfillCycleExecutor(
			dataSource,
			parseContinuousFullHistoryOperationBackfillConfig(enabledEnvironment),
			{ acquireLeadership, execute }
		);

		const first = runCycle();
		await expect(runCycle()).rejects.toThrow('must not overlap');
		leadership.resolve({
			acquired: true,
			release: jest.fn().mockResolvedValue(undefined)
		});
		await expect(first).resolves.toMatchObject({ status: 'executed' });
		expect(acquireLeadership).toHaveBeenCalledTimes(1);
	});

	it('drains on a signal, unregisters handlers, and closes the DataSource', async () => {
		const fixture = createFixture();
		fixture.runLoop.mockImplementationOnce(async (_config, loop) => {
			expect(loop.shouldStop()).toBe(false);
			fixture.signalHandler?.();
			expect(loop.shouldStop()).toBe(true);
		});

		await expect(
			runContinuousFullHistoryOperationBackfillCli(
				enabledEnvironment,
				fixture.dependencies
			)
		).resolves.toBe(0);
		expect(fixture.createCycleExecutor).toHaveBeenCalledWith(
			fixture.dataSource,
			expect.objectContaining({ batchLimit: 12, cpuWorkerCount: 12 })
		);
		expect(fixture.destroy).toHaveBeenCalledTimes(1);
		expect(fixture.unregisterSignals).toHaveBeenCalledTimes(1);
		expect(fixture.stdout.write).toHaveBeenCalledWith(
			expect.stringContaining('"status":"stopped"')
		);
	});

	it('refuses incomplete schema and never creates an executor', async () => {
		const fixture = createFixture();
		fixture.checkReadiness.mockResolvedValue({
			missingSchemaObjects: [
				'full_history_operation_batch_coverage.operation_decoder_version'
			],
			pendingMigrations: true,
			ready: false
		});

		await expect(
			runContinuousFullHistoryOperationBackfillCli(
				enabledEnvironment,
				fixture.dependencies
			)
		).resolves.toBe(69);
		expect(fixture.createCycleExecutor).not.toHaveBeenCalled();
		expect(fixture.destroy).toHaveBeenCalledTimes(1);
	});

	it('bounds each structured JSON log line', async () => {
		const fixture = createFixture();
		fixture.runLoop.mockImplementationOnce(async (_config, loop) => {
			loop.emit({
				at: '2026-07-14T00:00:00.000Z',
				cycle: 1,
				durationMs: 1,
				event: 'cycle-error',
				message: 'x'.repeat(8_192),
				retryInMs: 30_000,
				status: 'failed'
			});
		});

		await runContinuousFullHistoryOperationBackfillCli(
			enabledEnvironment,
			fixture.dependencies
		);
		expect(fixture.stdout.write).toHaveBeenCalledWith(
			'{"event":"runtime","status":"output-bound-exceeded"}\n'
		);
	});
});

function createFixture() {
	let initialized = false;
	let signalHandler: (() => void) | null = null;
	const dataSource = mock<DataSource>();
	Object.defineProperty(dataSource, 'isInitialized', {
		configurable: true,
		get: () => initialized
	});
	Object.defineProperty(dataSource, 'options', {
		configurable: true,
		value: { migrationsRun: false, synchronize: false, type: 'postgres' }
	});
	const destroy = jest.fn(async () => {
		initialized = false;
	});
	dataSource.destroy.mockImplementation(destroy);
	dataSource.initialize.mockImplementation(async () => {
		initialized = true;
		return dataSource;
	});
	const checkReadiness = jest.fn().mockResolvedValue({
		missingSchemaObjects: [],
		pendingMigrations: false,
		ready: true
	});
	const createCycleExecutor = jest.fn(() =>
		jest.fn(async () => ({ status: 'leadership-unavailable' as const }))
	);
	const runLoop = jest.fn(async () => undefined);
	const stdout = { write: jest.fn() };
	const stderr = { write: jest.fn() };
	const unregisterSignals = jest.fn();
	const dependencies: ContinuousFullHistoryOperationBackfillCliDependencies = {
		checkReadiness,
		createCycleExecutor,
		createDataSource: () => dataSource,
		now: () => 1_000,
		registerSignals: (stop) => {
			signalHandler = stop;
			return unregisterSignals;
		},
		runLoop,
		scheduleHeartbeat: () => () => undefined,
		stderr,
		stdout,
		wait: async () => undefined
	};
	return {
		checkReadiness,
		createCycleExecutor,
		dataSource,
		dependencies,
		destroy,
		runLoop,
		stderr,
		get signalHandler() {
			return signalHandler;
		},
		stdout,
		unregisterSignals
	};
}

function executionResult(status: 'completed' | 'idle') {
	return {
		accountReferenceFacts: 0,
		batchLimit: 12,
		completedBatches: 0,
		cpuWorkers: 12,
		operationFacts: 0,
		peakActiveBatches: 0,
		receipts: [],
		selectedBatches: 0,
		status,
		workerMetrics: workerMetrics()
	};
}

function workerMetrics(): FullHistoryOperationWorkerMetrics {
	return {
		activeWorkers: 0,
		completedTasks: 0,
		failedTasks: 0,
		peakActiveWorkers: 0,
		peakArrayBuffersBytes: 0,
		peakExternalBytes: 0,
		peakHeapUsedBytes: 0,
		queuedTasks: 0,
		resourceLimitMb: 2_048,
		retryCount: 0,
		workerCapacity: 12
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
