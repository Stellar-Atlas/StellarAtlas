import type { DataSource, QueryRunner } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
	composeFullHistoryPromotionRuntimeRepository,
	composeNextFullHistoryCheckpointPromoter,
	createFullHistoryPromotionDataSource
} from './FullHistoryPromotionComposition.js';
import {
	fullHistoryPromotionLoopErrorCode,
	runFullHistoryPromotionLoop,
	type FullHistoryPromotionLoopConfig,
	type FullHistoryPromotionLoopEvent
} from './FullHistoryPromotionLoop.js';
import {
	checkFullHistoryPromotionSchemaReadiness,
	type FullHistoryPromotionSchemaReadiness
} from './FullHistoryPromotionSchemaReadiness.js';
import type { FullHistoryPromotionRuntimeRepository } from '../../../domain/full-history-promotion/FullHistoryPromotionRuntimeRepository.js';
import type { PromoteNextFullHistoryCheckpointResult } from '../../../use-cases/promote-next-full-history-checkpoint/PromoteNextFullHistoryCheckpoint.js';

const leadershipLockId = '814504230712';
const maximumOutputBytes = 4_096;
const enabledEnvironmentKey = 'FULL_HISTORY_CONTINUOUS_PROMOTION_ENABLED';
const passphraseEnvironmentKey = 'FULL_HISTORY_NETWORK_PASSPHRASE';

interface LockRow {
	readonly acquired: boolean;
}

interface WritableOutput {
	write(value: string): unknown;
}

export interface FullHistoryPromotionSchemaWaitEvent {
	readonly errorCode: 'schema-migrations-pending';
	readonly missingSchemaObjects: readonly string[];
	readonly pendingMigrations: true;
	readonly retryInMs: number;
	readonly status: 'schema-not-ready';
}

interface FullHistoryPromotionSchemaWaitDependencies {
	readonly checkReadiness: () => Promise<FullHistoryPromotionSchemaReadiness>;
	readonly emit: (event: FullHistoryPromotionSchemaWaitEvent) => void;
	readonly shouldStop: () => boolean;
	readonly wait: (milliseconds: number) => Promise<void>;
}

export async function runContinuousFullHistoryPromotionCli(
	environment: NodeJS.ProcessEnv = process.env,
	stdout: WritableOutput = process.stdout,
	stderr: WritableOutput = process.stderr
): Promise<number> {
	let config: FullHistoryPromotionLoopConfig;
	try {
		config = parseLoopConfig(environment);
	} catch (error) {
		writeEvent(stderr, { message: safeMessage(error), status: 'refused' });
		return 64;
	}

	const abortController = new AbortController();
	const stop = (): void => abortController.abort();
	process.once('SIGINT', stop);
	process.once('SIGTERM', stop);
	let dataSource: DataSource | null = null;
	let lockRunner: QueryRunner | null = null;
	let runtime: FullHistoryPromotionRuntimeRepository | null = null;
	let runtimeFailed = false;
	let runtimeStarted = false;
	const instanceId = randomUUID();
	try {
		const promotionDataSource = createFullHistoryPromotionDataSource();
		dataSource = promotionDataSource;
		await promotionDataSource.initialize();
		const readiness = await waitForFullHistoryPromotionSchemaReadiness(
			config.errorBackoffMs,
			{
				checkReadiness: () =>
					checkFullHistoryPromotionSchemaReadiness(promotionDataSource),
				emit: (event) => writeEvent(stderr, event),
				shouldStop: () => abortController.signal.aborted,
				wait: (milliseconds) => wait(milliseconds, abortController.signal)
			}
		);
		if (readiness === null) return 0;
		if (!readiness.ready) {
			writeEvent(stderr, {
				missingSchemaObjects: readiness.missingSchemaObjects.slice(0, 32),
				pendingMigrations: readiness.pendingMigrations,
				status: 'schema-not-ready'
			});
			return 69;
		}
		lockRunner = promotionDataSource.createQueryRunner();
		await lockRunner.connect();
		if (!(await acquireLeadership(lockRunner))) {
			writeEvent(stderr, { status: 'leadership-unavailable' });
			return 75;
		}

		const promoter =
			composeNextFullHistoryCheckpointPromoter(promotionDataSource);
		const runtimeRepository =
			composeFullHistoryPromotionRuntimeRepository(promotionDataSource);
		runtime = runtimeRepository;
		await runtimeRepository.begin(config.networkPassphrase, instanceId);
		runtimeStarted = true;
		await runFullHistoryPromotionLoop(config, {
			emit: (event) => writeEvent(stdout, event),
			promoteNext: async () => {
				try {
					await runtimeRepository.markAttempt(
						config.networkPassphrase,
						instanceId
					);
					const result = await promoter.execute(config.networkPassphrase);
					await runtimeRepository.recordOutcome(
						config.networkPassphrase,
						instanceId,
						toRuntimeOutcome(result)
					);
					return result;
				} catch (error) {
					await runtimeRepository
						.recordFailure(
							config.networkPassphrase,
							instanceId,
							fullHistoryPromotionLoopErrorCode(error)
						)
						.catch(() => undefined);
					throw error;
				}
			},
			shouldStop: () => abortController.signal.aborted,
			wait: (milliseconds) => wait(milliseconds, abortController.signal)
		});
		return 0;
	} catch (error) {
		if (runtimeStarted && !runtimeFailed && runtime !== null) {
			runtimeFailed = true;
			await runtime
				.recordFailure(
					config.networkPassphrase,
					instanceId,
					fullHistoryPromotionLoopErrorCode(error)
				)
				.catch(() => undefined);
		}
		writeEvent(stderr, { message: safeMessage(error), status: 'failed' });
		return 75;
	} finally {
		process.off('SIGINT', stop);
		process.off('SIGTERM', stop);
		if (runtimeStarted && !runtimeFailed && runtime !== null) {
			await runtime
				.stop(config.networkPassphrase, instanceId)
				.catch(() => undefined);
		}
		if (lockRunner !== null) {
			try {
				await releaseLeadership(lockRunner);
			} finally {
				await lockRunner.release();
			}
		}
		if (dataSource?.isInitialized) await dataSource.destroy();
	}
}

export async function waitForFullHistoryPromotionSchemaReadiness(
	errorBackoffMs: number,
	dependencies: FullHistoryPromotionSchemaWaitDependencies
): Promise<FullHistoryPromotionSchemaReadiness | null> {
	while (!dependencies.shouldStop()) {
		const readiness = await dependencies.checkReadiness();
		if (dependencies.shouldStop()) return null;
		if (readiness.ready || !readiness.pendingMigrations) return readiness;
		dependencies.emit({
			errorCode: 'schema-migrations-pending',
			missingSchemaObjects: readiness.missingSchemaObjects.slice(0, 32),
			pendingMigrations: true,
			retryInMs: errorBackoffMs,
			status: 'schema-not-ready'
		});
		if (!dependencies.shouldStop()) await dependencies.wait(errorBackoffMs);
	}
	return null;
}

function toRuntimeOutcome(
	result: PromoteNextFullHistoryCheckpointResult
): Parameters<FullHistoryPromotionRuntimeRepository['recordOutcome']>[2] {
	if (!('checkpointLedger' in result)) {
		return {
			checkpointLedger: result.target.checkpointLedger,
			nextLedger: result.receipt.nextLedger,
			outcome: result.status
		};
	}
	return {
		checkpointLedger: result.checkpointLedger,
		nextLedger: result.nextLedger,
		outcome: result.status
	};
}

export function parseLoopConfig(
	environment: NodeJS.ProcessEnv
): FullHistoryPromotionLoopConfig {
	if (environment[enabledEnvironmentKey] !== 'true') {
		throw new Error(`${enabledEnvironmentKey} must equal true`);
	}
	const networkPassphrase = environment[passphraseEnvironmentKey];
	if (typeof networkPassphrase !== 'string' || networkPassphrase.length === 0) {
		throw new Error(`${passphraseEnvironmentKey} is required`);
	}
	return {
		errorBackoffMs: readInteger(
			environment.FULL_HISTORY_PROMOTION_ERROR_BACKOFF_MS,
			30_000,
			1_000,
			86_400_000
		),
		maximumCheckpointsPerCycle: readInteger(
			environment.FULL_HISTORY_PROMOTION_BATCHES_PER_CYCLE,
			4,
			1,
			32
		),
		networkPassphrase,
		pollIntervalMs: readInteger(
			environment.FULL_HISTORY_PROMOTION_POLL_INTERVAL_MS,
			15_000,
			1_000,
			300_000
		)
	};
}

async function acquireLeadership(queryRunner: QueryRunner): Promise<boolean> {
	const rows = (await queryRunner.query(
		'select pg_try_advisory_lock($1::bigint) as acquired',
		[leadershipLockId]
	)) as LockRow[];
	return rows[0]?.acquired === true;
}

async function releaseLeadership(queryRunner: QueryRunner): Promise<void> {
	await queryRunner.query('select pg_advisory_unlock($1::bigint)', [
		leadershipLockId
	]);
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
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

function readInteger(
	value: string | undefined,
	fallback: number,
	minimum: number,
	maximum: number
): number {
	if (value === undefined) return fallback;
	if (!/^[0-9]+$/.test(value))
		throw new Error('Loop setting is not an integer');
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
		throw new Error(`Loop setting must be between ${minimum} and ${maximum}`);
	}
	return parsed;
}

function writeEvent(output: WritableOutput, value: object): void {
	const serialized = JSON.stringify(value);
	output.write(
		Buffer.byteLength(serialized) <= maximumOutputBytes
			? `${serialized}\n`
			: '{"status":"output-bound-exceeded"}\n'
	);
}

function safeMessage(error: unknown): string {
	return (error instanceof Error ? error.message : String(error))
		.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database-url-redacted]')
		.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.slice(0, 384);
}
