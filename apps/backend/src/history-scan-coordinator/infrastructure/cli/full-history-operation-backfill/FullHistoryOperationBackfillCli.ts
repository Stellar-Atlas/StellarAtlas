import type { DataSource } from 'typeorm';
import {
	FULL_HISTORY_OPERATION_BACKFILL_BATCH_LIMIT_MAX,
	FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS_DEFAULT,
	FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS_MAX
} from '../../../domain/full-history-operation-backfill/FullHistoryOperationBackfill.js';
import {
	checkFullHistoryOperationBackfillReadiness,
	createFullHistoryOperationBackfillDataSource,
	executeFullHistoryOperationBackfill,
	FullHistoryOperationBackfillExecutionError,
	type FullHistoryOperationBackfillExecutionResult,
	type FullHistoryOperationBackfillReadiness
} from './FullHistoryOperationBackfillComposition.js';
import {
	acquireFullHistoryOperationBackfillLeadership,
	type FullHistoryOperationBackfillLeadershipLease
} from './FullHistoryOperationBackfillLeadership.js';

const confirmation = 'run-one-bounded-operation-backfill';
const maximumOutputBytes = 4_096;

interface WritableOutput {
	write(value: string): unknown;
}

interface FullHistoryOperationBackfillCliConfig {
	readonly batchLimit: number;
	readonly cpuWorkerCount: number;
	readonly networkPassphrase: string;
}

export interface FullHistoryOperationBackfillCliDependencies {
	readonly acquireLeadership: (
		dataSource: DataSource
	) => Promise<FullHistoryOperationBackfillLeadershipLease>;
	readonly checkReadiness: (
		dataSource: DataSource
	) => Promise<FullHistoryOperationBackfillReadiness>;
	readonly createDataSource: () => DataSource;
	readonly execute: (
		dataSource: DataSource,
		config: FullHistoryOperationBackfillCliConfig
	) => Promise<FullHistoryOperationBackfillExecutionResult>;
	readonly stderr: WritableOutput;
	readonly stdout: WritableOutput;
}

const defaultDependencies: FullHistoryOperationBackfillCliDependencies = {
	acquireLeadership: acquireFullHistoryOperationBackfillLeadership,
	checkReadiness: checkFullHistoryOperationBackfillReadiness,
	createDataSource: createFullHistoryOperationBackfillDataSource,
	execute: executeFullHistoryOperationBackfill,
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
	let leadership: FullHistoryOperationBackfillLeadershipLease | null = null;
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
		leadership = await dependencies.acquireLeadership(dataSource);
		if (!leadership.acquired) {
			writeEvent(dependencies.stdout, { status: 'skipped-locked' });
			return 0;
		}
		const result = await dependencies.execute(dataSource, config);
		writeEvent(dependencies.stdout, compactExecutionResult(result));
		return 0;
	} catch (error) {
		writeEvent(dependencies.stderr, {
			message: safeMessage(error),
			status: 'failed',
			...(error instanceof FullHistoryOperationBackfillExecutionError
				? { workerMetrics: error.workerMetrics }
				: {})
		});
		return 75;
	} finally {
		await leadership?.release().catch(() => undefined);
		if (dataSource?.isInitialized) {
			await dataSource.destroy().catch(() => undefined);
		}
	}
}

function compactExecutionResult(
	result: FullHistoryOperationBackfillExecutionResult
): Omit<FullHistoryOperationBackfillExecutionResult, 'receipts'> & {
	readonly completedBatchIds: readonly string[];
} {
	const { receipts, ...summary } = result;
	return {
		...summary,
		completedBatchIds: receipts.map((receipt) => receipt.batchId)
	};
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
		cpuWorkerCount: readCpuWorkerCount(
			environment.FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS
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
	if (
		!Number.isSafeInteger(parsed) ||
		parsed < 1 ||
		parsed > FULL_HISTORY_OPERATION_BACKFILL_BATCH_LIMIT_MAX
	) {
		throw new Error(
			`Operation-backfill batch limit must be between 1 and ${FULL_HISTORY_OPERATION_BACKFILL_BATCH_LIMIT_MAX}`
		);
	}
	return parsed;
}

function readCpuWorkerCount(value: string | undefined): number {
	if (value === undefined) {
		return FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS_DEFAULT;
	}
	if (!/^[0-9]+$/.test(value)) {
		throw new Error('Operation-backfill CPU worker count is not an integer');
	}
	const parsed = Number(value);
	if (
		!Number.isSafeInteger(parsed) ||
		parsed < 1 ||
		parsed > FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS_MAX
	) {
		throw new Error(
			`Operation-backfill CPU worker count must be between 1 and ${FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS_MAX}`
		);
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
