import type { DataSource } from 'typeorm';
import type { BackfillFullHistoryOperationsResult } from '../../../use-cases/backfill-full-history-operations/BackfillFullHistoryOperations.js';
import {
	checkFullHistoryOperationBackfillReadiness,
	composeFullHistoryOperationBackfill,
	createFullHistoryOperationBackfillDataSource,
	type FullHistoryOperationBackfillReadiness
} from './FullHistoryOperationBackfillComposition.js';

const confirmation = 'run-one-bounded-operation-backfill';
const maximumOutputBytes = 4_096;

interface WritableOutput {
	write(value: string): unknown;
}

interface FullHistoryOperationBackfillCliConfig {
	readonly batchLimit: number;
	readonly networkPassphrase: string;
}

export interface FullHistoryOperationBackfillCliDependencies {
	readonly checkReadiness: (
		dataSource: DataSource
	) => Promise<FullHistoryOperationBackfillReadiness>;
	readonly createDataSource: () => DataSource;
	readonly execute: (
		dataSource: DataSource,
		config: FullHistoryOperationBackfillCliConfig
	) => Promise<BackfillFullHistoryOperationsResult>;
	readonly stderr: WritableOutput;
	readonly stdout: WritableOutput;
}

const defaultDependencies: FullHistoryOperationBackfillCliDependencies = {
	checkReadiness: checkFullHistoryOperationBackfillReadiness,
	createDataSource: createFullHistoryOperationBackfillDataSource,
	execute: async (dataSource, config) =>
		composeFullHistoryOperationBackfill(dataSource).execute(config),
	stderr: process.stderr,
	stdout: process.stdout
};

export async function runFullHistoryOperationBackfillCli(
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: FullHistoryOperationBackfillCliDependencies = defaultDependencies
): Promise<number> {
	let config: FullHistoryOperationBackfillCliConfig;
	try {
		config = parseFullHistoryOperationBackfillCliConfig(environment);
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
		const result = await dependencies.execute(dataSource, config);
		writeEvent(dependencies.stdout, result);
		return 0;
	} catch (error) {
		writeEvent(dependencies.stderr, {
			message: safeMessage(error),
			status: 'failed'
		});
		return 75;
	} finally {
		if (dataSource?.isInitialized) {
			await dataSource.destroy().catch(() => undefined);
		}
	}
}

export function parseFullHistoryOperationBackfillCliConfig(
	environment: NodeJS.ProcessEnv
): FullHistoryOperationBackfillCliConfig {
	if (
		environment.FULL_HISTORY_OPERATION_BACKFILL_OPERATOR_CONFIRM !==
		confirmation
	) {
		throw new Error('Explicit operation-backfill confirmation is required');
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
		batchLimit: readBatchLimit(
			environment.FULL_HISTORY_OPERATION_BACKFILL_BATCHES
		),
		networkPassphrase
	};
}

function readBatchLimit(value: string | undefined): number {
	if (value === undefined) return 1;
	if (!/^[0-9]+$/.test(value)) {
		throw new Error('Operation-backfill batch limit is not an integer');
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 8) {
		throw new Error('Operation-backfill batch limit must be between 1 and 8');
	}
	return parsed;
}

function assertSafeDataSource(dataSource: DataSource): void {
	if (
		dataSource.options.migrationsRun === true ||
		dataSource.options.synchronize
	) {
		throw new Error('Operation-backfill DataSource must not mutate schema');
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
