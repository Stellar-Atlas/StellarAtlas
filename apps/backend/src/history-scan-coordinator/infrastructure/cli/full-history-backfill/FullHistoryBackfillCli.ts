import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import type { RunFullHistoryBackfillResult } from '../../../use-cases/run-full-history-backfill/RunFullHistoryBackfill.js';
import type { ScheduleFullHistoryBackfillResult } from '../../../use-cases/schedule-full-history-backfill/ScheduleFullHistoryBackfill.js';
import {
	checkFullHistoryBackfillSchemaReadiness,
	composeFullHistoryBackfill,
	createFullHistoryBackfillDataSource,
	type FullHistoryBackfillSchemaReadiness
} from './FullHistoryBackfillComposition.js';

const confirmation = 'run-one-bounded-backfill-invocation';
const maximumOutputBytes = 4_096;

interface WritableOutput {
	write(value: string): unknown;
}

interface FullHistoryBackfillCliConfig {
	readonly checkpointCount: number;
	readonly leaseDurationMs: number;
	readonly maxAttempts: number;
	readonly maximumProofTargets: number;
	readonly networkPassphrase: string;
	readonly retryDelayMs: number;
}

export interface FullHistoryBackfillCliDependencies {
	readonly checkReadiness: (
		dataSource: DataSource
	) => Promise<FullHistoryBackfillSchemaReadiness>;
	readonly createDataSource: () => DataSource;
	readonly createWorkerId: () => string;
	readonly execute: (
		dataSource: DataSource,
		config: FullHistoryBackfillCliConfig,
		workerId: string
	) => Promise<{
		readonly run: RunFullHistoryBackfillResult;
		readonly schedule: ScheduleFullHistoryBackfillResult;
	}>;
	readonly stderr: WritableOutput;
	readonly stdout: WritableOutput;
}

const defaultDependencies: FullHistoryBackfillCliDependencies = {
	checkReadiness: checkFullHistoryBackfillSchemaReadiness,
	createDataSource: createFullHistoryBackfillDataSource,
	createWorkerId: randomUUID,
	execute: async (dataSource, config, workerId) => {
		const backfill = composeFullHistoryBackfill(dataSource);
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
	},
	stderr: process.stderr,
	stdout: process.stdout
};

export async function runFullHistoryBackfillCli(
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: FullHistoryBackfillCliDependencies = defaultDependencies
): Promise<number> {
	let config: FullHistoryBackfillCliConfig;
	try {
		config = parseFullHistoryBackfillCliConfig(environment);
	} catch (error) {
		writeEvent(dependencies.stderr, {
			message: safeMessage(error),
			status: 'refused'
		});
		return 64;
	}

	let dataSource: DataSource | null = null;
	try {
		dataSource = dependencies.createDataSource();
		assertSafeDataSource(dataSource);
		await dataSource.initialize();
		const readiness = await dependencies.checkReadiness(dataSource);
		if (!readiness.ready) {
			writeEvent(dependencies.stderr, {
				missingSchemaObjects: readiness.missingSchemaObjects.slice(0, 32),
				pendingMigrations: readiness.pendingMigrations,
				status: 'schema-not-ready'
			});
			return 69;
		}
		const result = await dependencies.execute(
			dataSource,
			config,
			dependencies.createWorkerId()
		);
		writeEvent(dependencies.stdout, result);
		return result.run.status === 'proof-pending' ? 75 : 0;
	} catch (error) {
		writeEvent(dependencies.stderr, {
			message: safeMessage(error),
			status: 'failed'
		});
		return 75;
	} finally {
		if (dataSource?.isInitialized)
			await dataSource.destroy().catch(() => undefined);
	}
}

export function parseFullHistoryBackfillCliConfig(
	environment: NodeJS.ProcessEnv
): FullHistoryBackfillCliConfig {
	if (environment.FULL_HISTORY_BACKFILL_OPERATOR_CONFIRM !== confirmation) {
		throw new Error('Explicit bounded-backfill confirmation is required');
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
		checkpointCount: readInteger(
			environment.FULL_HISTORY_BACKFILL_CHECKPOINTS,
			1,
			1,
			8
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
		retryDelayMs: readInteger(
			environment.FULL_HISTORY_BACKFILL_RETRY_MS,
			15_000,
			0,
			86_400_000
		)
	};
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

function assertSafeDataSource(dataSource: DataSource): void {
	if (
		dataSource.options.migrationsRun === true ||
		dataSource.options.synchronize
	) {
		throw new Error('Backfill DataSource must not mutate schema');
	}
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
