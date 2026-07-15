import type { DataSource } from 'typeorm';
import {
	FULL_HISTORY_OPERATION_BACKFILL_BATCH_LIMIT_MAX,
	FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS_MAX,
	FULL_HISTORY_OPERATION_BACKFILL_DATABASE_WORKERS_DEFAULT,
	FULL_HISTORY_OPERATION_BACKFILL_DATABASE_WORKERS_MAX
} from '../../../domain/full-history-operation-backfill/FullHistoryOperationBackfill.js';
import {
	checkFullHistoryOperationBackfillReadiness,
	createFullHistoryOperationBackfillDataSource,
	executeFullHistoryOperationBackfill,
	FullHistoryOperationBackfillExecutionError,
	type FullHistoryOperationBackfillReadiness
} from './FullHistoryOperationBackfillComposition.js';
import {
	acquireFullHistoryOperationBackfillLeadership,
	type FullHistoryOperationBackfillLeadershipLease
} from './FullHistoryOperationBackfillLeadership.js';
import {
	runContinuousFullHistoryOperationBackfillLoop,
	type ContinuousFullHistoryOperationBackfillCycleResult,
	type ContinuousFullHistoryOperationBackfillFailure,
	type ContinuousFullHistoryOperationBackfillLoopConfig,
	type ContinuousFullHistoryOperationBackfillLoopDependencies
} from './ContinuousFullHistoryOperationBackfillLoop.js';

const enabledEnvironmentKey =
	'FULL_HISTORY_CONTINUOUS_OPERATION_BACKFILL_ENABLED';
const maximumOutputBytes = 4_096;

interface WritableOutput {
	write(value: string): unknown;
}

export interface ContinuousFullHistoryOperationBackfillConfig extends ContinuousFullHistoryOperationBackfillLoopConfig {
	readonly networkPassphrase: string;
}

interface CycleExecutorDependencies {
	readonly acquireLeadership: (
		dataSource: DataSource
	) => Promise<FullHistoryOperationBackfillLeadershipLease>;
	readonly execute: typeof executeFullHistoryOperationBackfill;
}

export interface ContinuousFullHistoryOperationBackfillCliDependencies {
	readonly checkReadiness: (
		dataSource: DataSource
	) => Promise<FullHistoryOperationBackfillReadiness>;
	readonly createCycleExecutor: (
		dataSource: DataSource,
		config: ContinuousFullHistoryOperationBackfillConfig
	) => () => Promise<ContinuousFullHistoryOperationBackfillCycleResult>;
	readonly createDataSource: () => DataSource;
	readonly now: () => number;
	readonly registerSignals: (stop: () => void) => () => void;
	readonly runLoop: (
		config: ContinuousFullHistoryOperationBackfillLoopConfig,
		dependencies: ContinuousFullHistoryOperationBackfillLoopDependencies
	) => Promise<void>;
	readonly scheduleHeartbeat: (
		emit: () => void,
		intervalMs: number
	) => () => void;
	readonly stderr: WritableOutput;
	readonly stdout: WritableOutput;
	readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

const cycleExecutorDependencies: CycleExecutorDependencies = {
	acquireLeadership: acquireFullHistoryOperationBackfillLeadership,
	execute: executeFullHistoryOperationBackfill
};

const defaultDependencies: ContinuousFullHistoryOperationBackfillCliDependencies =
	{
		checkReadiness: checkFullHistoryOperationBackfillReadiness,
		createCycleExecutor: (dataSource, config) =>
			createContinuousFullHistoryOperationBackfillCycleExecutor(
				dataSource,
				config,
				cycleExecutorDependencies
			),
		createDataSource: createFullHistoryOperationBackfillDataSource,
		now: Date.now,
		registerSignals,
		runLoop: runContinuousFullHistoryOperationBackfillLoop,
		scheduleHeartbeat,
		stderr: process.stderr,
		stdout: process.stdout,
		wait: waitForAbort
	};

export function createContinuousFullHistoryOperationBackfillCycleExecutor(
	dataSource: DataSource,
	config: ContinuousFullHistoryOperationBackfillConfig,
	dependencies: CycleExecutorDependencies = cycleExecutorDependencies
): () => Promise<ContinuousFullHistoryOperationBackfillCycleResult> {
	let executing = false;
	return async () => {
		if (executing) {
			throw new Error('Operation-backfill cycles must not overlap');
		}
		executing = true;
		let leadership: FullHistoryOperationBackfillLeadershipLease | null = null;
		try {
			leadership = await dependencies.acquireLeadership(dataSource);
			if (!leadership.acquired) {
				return { status: 'leadership-unavailable' };
			}
			return {
				execution: await dependencies.execute(dataSource, {
					batchLimit: config.batchLimit,
					cpuWorkerCount: config.cpuWorkerCount,
					databaseWorkerCount: config.databaseWorkerCount,
					networkPassphrase: config.networkPassphrase
				}),
				status: 'executed'
			};
		} finally {
			try {
				await leadership?.release();
			} finally {
				executing = false;
			}
		}
	};
}

export async function runContinuousFullHistoryOperationBackfillCli(
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: ContinuousFullHistoryOperationBackfillCliDependencies = defaultDependencies
): Promise<number> {
	let config: ContinuousFullHistoryOperationBackfillConfig;
	try {
		config = parseContinuousFullHistoryOperationBackfillConfig(environment);
	} catch (error) {
		writeEvent(dependencies.stderr, {
			event: 'runtime',
			message: safeMessage(error),
			status: 'refused'
		});
		return 64;
	}

	const abortController = new AbortController();
	const unregisterSignals = dependencies.registerSignals(() =>
		abortController.abort()
	);
	let dataSource: DataSource | null = null;
	let exitCode = 0;
	try {
		dataSource = dependencies.createDataSource();
		assertSafeDataSource(dataSource);
		await dataSource.initialize();
		const readiness = await dependencies.checkReadiness(dataSource);
		if (!readiness.ready) {
			writeEvent(dependencies.stderr, {
				event: 'runtime',
				missingSchemaObjects: readiness.missingSchemaObjects.slice(0, 32),
				pendingMigrations: readiness.pendingMigrations,
				status: 'schema-not-ready'
			});
			exitCode = 69;
		} else {
			writeEvent(dependencies.stdout, {
				batchLimit: config.batchLimit,
				cpuWorkers: config.cpuWorkerCount,
				databaseWorkers: config.databaseWorkerCount,
				event: 'runtime',
				status: 'started'
			});
			await dependencies.runLoop(config, {
				describeFailure,
				emit: (event) => writeEvent(dependencies.stdout, event),
				executeCycle: dependencies.createCycleExecutor(dataSource, config),
				now: dependencies.now,
				scheduleHeartbeat: dependencies.scheduleHeartbeat,
				shouldStop: () => abortController.signal.aborted,
				wait: (milliseconds) =>
					dependencies.wait(milliseconds, abortController.signal)
			});
			writeEvent(dependencies.stdout, {
				event: 'runtime',
				status: 'stopped'
			});
		}
	} catch (error) {
		writeEvent(dependencies.stderr, {
			event: 'runtime',
			message: safeMessage(error),
			status: 'failed'
		});
		exitCode = 75;
	} finally {
		unregisterSignals();
		exitCode = await cleanUp(dataSource, exitCode, dependencies.stderr);
	}
	return exitCode;
}

export function parseContinuousFullHistoryOperationBackfillConfig(
	environment: NodeJS.ProcessEnv
): ContinuousFullHistoryOperationBackfillConfig {
	if (environment[enabledEnvironmentKey] !== 'true') {
		throw new Error(`${enabledEnvironmentKey} must equal true`);
	}
	const networkPassphrase = environment.FULL_HISTORY_NETWORK_PASSPHRASE;
	if (
		typeof networkPassphrase !== 'string' ||
		networkPassphrase.trim().length === 0 ||
		Buffer.byteLength(networkPassphrase) > 1_024
	) {
		throw new Error('FULL_HISTORY_NETWORK_PASSPHRASE is required');
	}
	return {
		batchLimit: readInteger(
			environment.FULL_HISTORY_OPERATION_BACKFILL_BATCHES,
			12,
			1,
			FULL_HISTORY_OPERATION_BACKFILL_BATCH_LIMIT_MAX
		),
		cpuWorkerCount: readInteger(
			environment.FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS,
			FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS_MAX,
			1,
			FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS_MAX
		),
		databaseWorkerCount: readInteger(
			environment.FULL_HISTORY_OPERATION_BACKFILL_DATABASE_WORKERS,
			FULL_HISTORY_OPERATION_BACKFILL_DATABASE_WORKERS_DEFAULT,
			1,
			FULL_HISTORY_OPERATION_BACKFILL_DATABASE_WORKERS_MAX
		),
		errorBackoffMs: readInteger(
			environment.FULL_HISTORY_OPERATION_BACKFILL_ERROR_BACKOFF_MS,
			30_000,
			1_000,
			86_400_000
		),
		heartbeatIntervalMs: readInteger(
			environment.FULL_HISTORY_OPERATION_BACKFILL_HEARTBEAT_MS,
			60_000,
			10_000,
			300_000
		),
		idleBackoffMs: readInteger(
			environment.FULL_HISTORY_OPERATION_BACKFILL_IDLE_BACKOFF_MS,
			15_000,
			1_000,
			86_400_000
		),
		leadershipBackoffMs: readInteger(
			environment.FULL_HISTORY_OPERATION_BACKFILL_LOCK_BACKOFF_MS,
			30_000,
			1_000,
			86_400_000
		),
		networkPassphrase,
		successDelayMs: readInteger(
			environment.FULL_HISTORY_OPERATION_BACKFILL_SUCCESS_DELAY_MS,
			250,
			100,
			60_000
		)
	};
}

function describeFailure(
	error: unknown
): ContinuousFullHistoryOperationBackfillFailure {
	return {
		message: safeMessage(error),
		...(error instanceof FullHistoryOperationBackfillExecutionError
			? { workerMetrics: error.workerMetrics }
			: {})
	};
}

function registerSignals(stop: () => void): () => void {
	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);
	return () => {
		process.off('SIGINT', stop);
		process.off('SIGTERM', stop);
	};
}

function scheduleHeartbeat(emit: () => void, intervalMs: number): () => void {
	const timer = setInterval(emit, intervalMs);
	timer.unref();
	return () => clearInterval(timer);
}

function waitForAbort(
	milliseconds: number,
	signal: AbortSignal
): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		const timeout = setTimeout(done, milliseconds);
		function done(): void {
			clearTimeout(timeout);
			signal.removeEventListener('abort', done);
			resolve();
		}
		signal.addEventListener('abort', done, { once: true });
	});
}

async function cleanUp(
	dataSource: DataSource | null,
	exitCode: number,
	stderr: WritableOutput
): Promise<number> {
	try {
		if (dataSource?.isInitialized) await dataSource.destroy();
		return exitCode;
	} catch (error) {
		writeEvent(stderr, {
			event: 'runtime',
			message: safeMessage(error),
			status: 'cleanup-failed'
		});
		return 75;
	}
}

function assertSafeDataSource(dataSource: DataSource): void {
	if (
		dataSource.options.migrationsRun === true ||
		dataSource.options.synchronize
	) {
		throw new Error('Operation-backfill DataSource must not mutate schema');
	}
}

function readInteger(
	value: string | undefined,
	fallback: number,
	minimum: number,
	maximum: number
): number {
	if (value === undefined) return fallback;
	if (!/^[0-9]+$/.test(value)) {
		throw new Error('Operation-backfill runtime setting is not an integer');
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
		throw new Error(
			`Operation-backfill runtime setting must be between ${minimum} and ${maximum}`
		);
	}
	return parsed;
}

function writeEvent(output: WritableOutput, value: object): void {
	const serialized = JSON.stringify(value);
	output.write(
		Buffer.byteLength(serialized) <= maximumOutputBytes
			? `${serialized}\n`
			: '{"event":"runtime","status":"output-bound-exceeded"}\n'
	);
}

function safeMessage(error: unknown): string {
	return (error instanceof Error ? error.message : String(error))
		.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database-url-redacted]')
		.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.slice(0, 384);
}
