import type { DataSource } from 'typeorm';
import { mock } from 'jest-mock-extended';
import {
	createContinuousFullHistoryBackfillCycleExecutor,
	parseContinuousFullHistoryBackfillConfig,
	runContinuousFullHistoryBackfillCli,
	type ContinuousFullHistoryBackfillCliDependencies,
	type ContinuousFullHistoryBackfillLeadershipLease
} from '../ContinuousFullHistoryBackfillCli.js';

const enabledEnvironment = {
	FULL_HISTORY_CONTINUOUS_BACKFILL_ENABLED: 'true',
	FULL_HISTORY_NETWORK_PASSPHRASE: 'Continuous CLI fixture network'
};

describe('continuous full-history backfill CLI', () => {
	it('requires explicit enablement and refuses a checkpoint count above one', () => {
		expect(() => parseContinuousFullHistoryBackfillConfig({})).toThrow(
			'FULL_HISTORY_CONTINUOUS_BACKFILL_ENABLED must equal true'
		);
		expect(() =>
			parseContinuousFullHistoryBackfillConfig({
				...enabledEnvironment,
				FULL_HISTORY_BACKFILL_CHECKPOINTS: '2'
			})
		).toThrow('must process one checkpoint at a time');
	});

	it('schedules exactly one checkpoint before each worker invocation', async () => {
		const schedule = jest.fn(async () => ({
			status: 'canonical-unavailable' as const
		}));
		const run = jest.fn(async () => ({ status: 'idle' as const }));
		const executeCycle = createContinuousFullHistoryBackfillCycleExecutor(
			{
				run: { execute: run },
				schedule: { execute: schedule }
			},
			parseContinuousFullHistoryBackfillConfig(enabledEnvironment),
			'00000000-0000-4000-8000-000000000099'
		);

		await expect(executeCycle()).resolves.toEqual({
			run: { status: 'idle' },
			schedule: { status: 'canonical-unavailable' }
		});
		expect(schedule).toHaveBeenCalledWith(
			expect.objectContaining({ checkpointCount: 1 })
		);
		expect(run).toHaveBeenCalledTimes(1);
		expect(schedule.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
			run.mock.invocationCallOrder[0] ?? 0
		);
	});

	it('runs one serialized executor with a fixed checkpoint count and stops on a signal', async () => {
		const fixture = createFixture();
		fixture.runLoop.mockImplementationOnce(async (_config, loop) => {
			expect(loop.shouldStop()).toBe(false);
			fixture.signalHandler?.();
			expect(loop.shouldStop()).toBe(true);
		});

		await expect(
			runContinuousFullHistoryBackfillCli(
				{
					...enabledEnvironment,
					FULL_HISTORY_BACKFILL_CHECKPOINTS: '1'
				},
				fixture.dependencies
			)
		).resolves.toBe(0);

		expect(fixture.createCycleExecutor).toHaveBeenCalledWith(
			fixture.dataSource,
			expect.objectContaining({ checkpointCount: 1 }),
			'00000000-0000-4000-8000-000000000099'
		);
		expect(fixture.runMigrations).not.toHaveBeenCalled();
		expect(fixture.releaseLeadership).toHaveBeenCalledTimes(1);
		expect(fixture.destroy).toHaveBeenCalledTimes(1);
		expect(fixture.unregisterSignals).toHaveBeenCalledTimes(1);
		expect(fixture.stdout.write).toHaveBeenCalledWith(
			expect.stringContaining('stopped')
		);
	});

	it('refuses missing schema without creating a cycle executor', async () => {
		const fixture = createFixture();
		fixture.checkReadiness.mockResolvedValue({
			missingSchemaObjects: ['full_history_historical_backfill_job'],
			pendingMigrations: false,
			ready: false
		});
		await expect(
			runContinuousFullHistoryBackfillCli(
				enabledEnvironment,
				fixture.dependencies
			)
		).resolves.toBe(69);
		expect(fixture.createCycleExecutor).not.toHaveBeenCalled();
		expect(fixture.acquireLeadership).not.toHaveBeenCalled();
		expect(fixture.runMigrations).not.toHaveBeenCalled();
	});

	it('refuses a schema-mutating DataSource before initialization', async () => {
		const fixture = createFixture({ migrationsRun: true });
		await expect(
			runContinuousFullHistoryBackfillCli(
				enabledEnvironment,
				fixture.dependencies
			)
		).resolves.toBe(75);
		expect(fixture.initialize).not.toHaveBeenCalled();
		expect(fixture.runMigrations).not.toHaveBeenCalled();
		expect(fixture.stderr.write).toHaveBeenCalledWith(
			expect.stringContaining('must not mutate schema')
		);
	});

	it('does not run when another continuous backfill process holds leadership', async () => {
		const fixture = createFixture();
		fixture.acquireLeadership.mockResolvedValue({
			acquired: false,
			release: fixture.releaseLeadership
		});
		await expect(
			runContinuousFullHistoryBackfillCli(
				enabledEnvironment,
				fixture.dependencies
			)
		).resolves.toBe(75);
		expect(fixture.runLoop).not.toHaveBeenCalled();
		expect(fixture.releaseLeadership).toHaveBeenCalledTimes(1);
	});
});

function createFixture(options: { readonly migrationsRun?: boolean } = {}) {
	let initialized = false;
	const dataSource = mock<DataSource>();
	Object.defineProperty(dataSource, 'isInitialized', {
		configurable: true,
		get: () => initialized
	});
	Object.defineProperty(dataSource, 'options', {
		configurable: true,
		value: {
			migrationsRun: options.migrationsRun ?? false,
			synchronize: false,
			type: 'postgres'
		}
	});
	const initialize = jest.fn(async () => {
		initialized = true;
		return dataSource;
	});
	const destroy = jest.fn(async () => {
		initialized = false;
	});
	dataSource.initialize.mockImplementation(initialize);
	dataSource.destroy.mockImplementation(destroy);
	const runMigrations = dataSource.runMigrations;
	const checkReadiness = jest.fn().mockResolvedValue({
		missingSchemaObjects: [],
		pendingMigrations: false,
		ready: true
	});
	const releaseLeadership = jest.fn(async () => undefined);
	const leadership: ContinuousFullHistoryBackfillLeadershipLease = {
		acquired: true,
		release: releaseLeadership
	};
	const acquireLeadership = jest.fn(async () => leadership);
	const executeCycle = jest.fn(async () => ({
		run: { status: 'idle' as const },
		schedule: { status: 'canonical-unavailable' as const }
	}));
	const createCycleExecutor = jest.fn(() => executeCycle);
	const runLoop = jest.fn(async () => undefined);
	const stdout = { write: jest.fn() };
	const stderr = { write: jest.fn() };
	const unregisterSignals = jest.fn();
	let signalHandler: (() => void) | null = null;
	const registerSignals = jest.fn((stop: () => void) => {
		signalHandler = stop;
		return unregisterSignals;
	});
	const dependencies: ContinuousFullHistoryBackfillCliDependencies = {
		acquireLeadership,
		checkReadiness,
		createCycleExecutor,
		createDataSource: () => dataSource,
		createWorkerId: () => '00000000-0000-4000-8000-000000000099',
		now: () => 1_000,
		registerSignals,
		runLoop,
		stderr,
		stdout,
		wait: async () => undefined
	};
	return {
		acquireLeadership,
		checkReadiness,
		createCycleExecutor,
		dataSource,
		dependencies,
		destroy,
		initialize,
		releaseLeadership,
		runLoop,
		runMigrations,
		stderr,
		get signalHandler() {
			return signalHandler;
		},
		stdout,
		unregisterSignals
	};
}
