import { randomUUID } from 'node:crypto';
import type { DataSource, QueryRunner } from 'typeorm';
import {
	checkFullHistoryBackfillSchemaReadiness,
	composeFullHistoryBackfill,
	createFullHistoryBackfillDataSource,
	type FullHistoryBackfillSchemaReadiness
} from './FullHistoryBackfillComposition.js';
import {
	runContinuousFullHistoryBackfillLoop,
	type ContinuousFullHistoryBackfillCycleResult,
	type ContinuousFullHistoryBackfillLoopConfig,
	type ContinuousFullHistoryBackfillLoopDependencies
} from './ContinuousFullHistoryBackfillLoop.js';
import type { RunFullHistoryBackfill } from '../../../use-cases/run-full-history-backfill/RunFullHistoryBackfill.js';
import type { ScheduleFullHistoryBackfill } from '../../../use-cases/schedule-full-history-backfill/ScheduleFullHistoryBackfill.js';

const enabledEnvironmentKey = 'FULL_HISTORY_CONTINUOUS_BACKFILL_ENABLED';
const leadershipLockId = '814504230713';
const maximumOutputBytes = 4_096;

interface WritableOutput {
	write(value: string): unknown;
}

export interface ContinuousFullHistoryBackfillLeadershipLease {
	readonly acquired: boolean;
	release(): Promise<void>;
}

interface LockRow {
	readonly acquired: boolean;
}

export interface ContinuousFullHistoryBackfillConfig extends ContinuousFullHistoryBackfillLoopConfig {
	readonly checkpointCount: 1;
	readonly leaseDurationMs: number;
	readonly maxAttempts: number;
	readonly maximumProofTargets: number;
	readonly networkPassphrase: string;
	readonly retryDelayMs: number;
}

export interface ContinuousFullHistoryBackfillCliDependencies {
	readonly acquireLeadership: (
		dataSource: DataSource
	) => Promise<ContinuousFullHistoryBackfillLeadershipLease>;
	readonly checkReadiness: (
		dataSource: DataSource
	) => Promise<FullHistoryBackfillSchemaReadiness>;
	readonly createCycleExecutor: (
		dataSource: DataSource,
		config: ContinuousFullHistoryBackfillConfig,
		workerId: string
	) => () => Promise<ContinuousFullHistoryBackfillCycleResult>;
	readonly createDataSource: () => DataSource;
	readonly createWorkerId: () => string;
	readonly now: () => number;
	readonly registerSignals: (stop: () => void) => () => void;
	readonly runLoop: (
		config: ContinuousFullHistoryBackfillLoopConfig,
		dependencies: ContinuousFullHistoryBackfillLoopDependencies
	) => Promise<void>;
	readonly stderr: WritableOutput;
	readonly stdout: WritableOutput;
	readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export interface ContinuousFullHistoryBackfillActions {
	readonly run: Pick<RunFullHistoryBackfill, 'execute'>;
	readonly schedule: Pick<ScheduleFullHistoryBackfill, 'execute'>;
}

const defaultDependencies: ContinuousFullHistoryBackfillCliDependencies = {
	acquireLeadership,
	checkReadiness: checkFullHistoryBackfillSchemaReadiness,
	createCycleExecutor: (dataSource, config, workerId) =>
		createContinuousFullHistoryBackfillCycleExecutor(
			composeFullHistoryBackfill(dataSource),
			config,
			workerId
		),
	createDataSource: createFullHistoryBackfillDataSource,
	createWorkerId: randomUUID,
	now: Date.now,
	registerSignals,
	runLoop: runContinuousFullHistoryBackfillLoop,
	stderr: process.stderr,
	stdout: process.stdout,
	wait: waitForAbort
};

export function createContinuousFullHistoryBackfillCycleExecutor(
	backfill: ContinuousFullHistoryBackfillActions,
	config: ContinuousFullHistoryBackfillConfig,
	workerId: string
): () => Promise<ContinuousFullHistoryBackfillCycleResult> {
	return async () => {
		const schedule = await backfill.schedule.execute({
			checkpointCount: config.checkpointCount,
			maxAttempts: config.maxAttempts,
			networkPassphrase: config.networkPassphrase
		});
		const run = await backfill.run.execute({
			leaseDurationMs: config.leaseDurationMs,
			maximumProofTargets: config.maximumProofTargets,
			networkPassphrase: config.networkPassphrase,
			retryDelayMs: config.retryDelayMs,
			workerId
		});
		return { run, schedule };
	};
}

export async function runContinuousFullHistoryBackfillCli(
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: ContinuousFullHistoryBackfillCliDependencies = defaultDependencies
): Promise<number> {
	let config: ContinuousFullHistoryBackfillConfig;
	try {
		config = parseContinuousFullHistoryBackfillConfig(environment);
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
	let leadership: ContinuousFullHistoryBackfillLeadershipLease | null = null;
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
			leadership = await dependencies.acquireLeadership(dataSource);
			if (!leadership.acquired) {
				writeEvent(dependencies.stderr, {
					event: 'runtime',
					status: 'leadership-unavailable'
				});
				exitCode = 75;
			} else {
				const executeCycle = dependencies.createCycleExecutor(
					dataSource,
					config,
					dependencies.createWorkerId()
				);
				await dependencies.runLoop(config, {
					emit: (event) => writeEvent(dependencies.stdout, event),
					executeCycle,
					formatError: safeMessage,
					now: dependencies.now,
					shouldStop: () => abortController.signal.aborted,
					wait: (milliseconds) =>
						dependencies.wait(milliseconds, abortController.signal)
				});
				writeEvent(dependencies.stdout, {
					event: 'runtime',
					status: 'stopped'
				});
			}
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
		exitCode = await cleanUp(
			dataSource,
			leadership,
			exitCode,
			dependencies.stderr
		);
	}
	return exitCode;
}

export function parseContinuousFullHistoryBackfillConfig(
	environment: NodeJS.ProcessEnv
): ContinuousFullHistoryBackfillConfig {
	if (environment[enabledEnvironmentKey] !== 'true') {
		throw new Error(`${enabledEnvironmentKey} must equal true`);
	}
	if (
		environment.FULL_HISTORY_BACKFILL_CHECKPOINTS !== undefined &&
		environment.FULL_HISTORY_BACKFILL_CHECKPOINTS !== '1'
	) {
		throw new Error(
			'Continuous backfill must process one checkpoint at a time'
		);
	}
	const networkPassphrase = environment.FULL_HISTORY_NETWORK_PASSPHRASE;
	if (
		typeof networkPassphrase !== 'string' ||
		networkPassphrase.trim().length === 0 ||
		Buffer.byteLength(networkPassphrase) > 1_024
	) {
		throw new Error('FULL_HISTORY_NETWORK_PASSPHRASE is required');
	}
	const proofPendingBackoffMs = readInteger(
		environment.FULL_HISTORY_BACKFILL_PROOF_PENDING_BACKOFF_MS,
		30_000,
		1_000,
		86_400_000
	);
	return {
		checkpointCount: 1,
		errorBackoffMs: readInteger(
			environment.FULL_HISTORY_BACKFILL_ERROR_BACKOFF_MS,
			30_000,
			1_000,
			86_400_000
		),
		evidenceRejectedBackoffMs: readInteger(
			environment.FULL_HISTORY_BACKFILL_EVIDENCE_REJECTED_BACKOFF_MS,
			60_000,
			1_000,
			86_400_000
		),
		heartbeatIntervalMs: readInteger(
			environment.FULL_HISTORY_BACKFILL_HEARTBEAT_MS,
			60_000,
			10_000,
			300_000
		),
		idleBackoffMs: readInteger(
			environment.FULL_HISTORY_BACKFILL_IDLE_BACKOFF_MS,
			15_000,
			1_000,
			86_400_000
		),
		leaseDurationMs: readInteger(
			environment.FULL_HISTORY_BACKFILL_LEASE_MS,
			300_000,
			1_000,
			900_000
		),
		maxAttempts: readInteger(
			environment.FULL_HISTORY_BACKFILL_MAX_ATTEMPTS,
			8,
			1,
			32_767
		),
		maximumProofTargets: readInteger(
			environment.FULL_HISTORY_BACKFILL_PROOF_TARGETS,
			4,
			1,
			8
		),
		networkPassphrase,
		proofPendingBackoffMs,
		retryDelayMs: readInteger(
			environment.FULL_HISTORY_BACKFILL_RETRY_MS,
			proofPendingBackoffMs,
			0,
			86_400_000
		),
		successDelayMs: readInteger(
			environment.FULL_HISTORY_BACKFILL_SUCCESS_DELAY_MS,
			250,
			100,
			60_000
		)
	};
}

async function acquireLeadership(
	dataSource: DataSource
): Promise<ContinuousFullHistoryBackfillLeadershipLease> {
	const queryRunner = dataSource.createQueryRunner();
	await queryRunner.connect();
	try {
		const rows = (await queryRunner.query(
			'select pg_try_advisory_lock($1::bigint) as acquired',
			[leadershipLockId]
		)) as LockRow[];
		const acquired = rows[0]?.acquired === true;
		return leadershipLease(queryRunner, acquired);
	} catch (error) {
		await queryRunner.release().catch(() => undefined);
		throw error;
	}
}

function leadershipLease(
	queryRunner: QueryRunner,
	acquired: boolean
): ContinuousFullHistoryBackfillLeadershipLease {
	let released = false;
	return {
		acquired,
		release: async () => {
			if (released) return;
			released = true;
			try {
				if (acquired) {
					await queryRunner.query('select pg_advisory_unlock($1::bigint)', [
						leadershipLockId
					]);
				}
			} finally {
				await queryRunner.release();
			}
		}
	};
}

function registerSignals(stop: () => void): () => void {
	process.once('SIGINT', stop);
	process.once('SIGTERM', stop);
	return () => {
		process.off('SIGINT', stop);
		process.off('SIGTERM', stop);
	};
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
	leadership: ContinuousFullHistoryBackfillLeadershipLease | null,
	exitCode: number,
	stderr: WritableOutput
): Promise<number> {
	let cleanupError: unknown = null;
	try {
		if (leadership !== null) await leadership.release();
	} catch (error) {
		cleanupError = error;
	}
	try {
		if (dataSource?.isInitialized) await dataSource.destroy();
	} catch (error) {
		cleanupError ??= error;
	}
	if (cleanupError !== null) {
		writeEvent(stderr, {
			event: 'runtime',
			message: safeMessage(cleanupError),
			status: 'cleanup-failed'
		});
		return 75;
	}
	return exitCode;
}

function assertSafeDataSource(dataSource: DataSource): void {
	if (
		dataSource.options.migrationsRun === true ||
		dataSource.options.synchronize
	) {
		throw new Error('Backfill DataSource must not mutate schema');
	}
}

function readInteger(
	value: string | undefined,
	fallback: number,
	minimum: number,
	maximum: number
): number {
	if (value === undefined) return fallback;
	if (!/^[0-9]+$/.test(value))
		throw new Error('Backfill setting is not an integer');
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
		throw new Error(
			`Backfill setting must be between ${minimum} and ${maximum}`
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
