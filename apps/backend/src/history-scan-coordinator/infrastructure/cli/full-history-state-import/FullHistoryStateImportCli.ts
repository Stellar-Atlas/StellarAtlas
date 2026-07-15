import type { DataSource } from 'typeorm';
import {
	composeFullHistoryStateImportWorkers,
	createFullHistoryStateImportDataSource,
	type FullHistoryStateImportWorker
} from './FullHistoryStateImportComposition.js';
import {
	checkFullHistoryStateImportReadiness,
	type FullHistoryStateImportReadiness
} from './FullHistoryStateImportReadiness.js';
import {
	parseFullHistoryStateImportServiceConfig,
	FULL_HISTORY_STATE_IMPORT_MAXIMUM_DATABASE_POOL_SIZE,
	type FullHistoryStateImportServiceConfig
} from './FullHistoryStateImportServiceConfig.js';
import {
	runFullHistoryStateImportWorkerLoop,
	waitForFullHistoryStateImport,
	type FullHistoryStateImportWorkerEvent,
	type FullHistoryStateImportWorkerLoopConfig,
	type FullHistoryStateImportWorkerLoopDependencies
} from './FullHistoryStateImportWorkerLoop.js';

const maximumOutputBytes = 4_096;

interface WritableOutput {
	write(value: string): unknown;
}

export interface FullHistoryStateImportCliDependencies {
	readonly checkReadiness: (
		dataSource: DataSource,
		config: FullHistoryStateImportServiceConfig
	) => Promise<FullHistoryStateImportReadiness>;
	readonly composeWorkers: (
		dataSource: DataSource,
		config: FullHistoryStateImportServiceConfig
	) => readonly FullHistoryStateImportWorker[];
	readonly createDataSource: (poolSize: number) => DataSource;
	readonly now: () => number;
	readonly registerSignals: (stop: () => void) => () => void;
	readonly runWorkerLoop: (
		config: FullHistoryStateImportWorkerLoopConfig,
		dependencies: FullHistoryStateImportWorkerLoopDependencies
	) => Promise<void>;
	readonly stderr: WritableOutput;
	readonly stdout: WritableOutput;
	readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

const defaultDependencies: FullHistoryStateImportCliDependencies = {
	checkReadiness: checkFullHistoryStateImportReadiness,
	composeWorkers: composeFullHistoryStateImportWorkers,
	createDataSource: createFullHistoryStateImportDataSource,
	now: Date.now,
	registerSignals,
	runWorkerLoop: runFullHistoryStateImportWorkerLoop,
	stderr: process.stderr,
	stdout: process.stdout,
	wait: waitForFullHistoryStateImport
};

export async function runFullHistoryStateImportCli(
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: FullHistoryStateImportCliDependencies = defaultDependencies
): Promise<number> {
	let config: FullHistoryStateImportServiceConfig;
	try {
		config = parseFullHistoryStateImportServiceConfig(environment);
	} catch (error) {
		writeEvent(dependencies.stderr, {
			event: 'runtime',
			message: safeMessage(error),
			status: 'refused'
		});
		return 64;
	}

	const abortController = new AbortController();
	let shutdownRequested = false;
	const unregisterSignals = dependencies.registerSignals(() => {
		shutdownRequested = true;
		abortController.abort(new Error('shutdown requested'));
	});
	let dataSource: DataSource | null = null;
	let exitCode = 0;
	let started = false;
	let workerRuns: readonly Promise<void>[] = [];
	try {
		dataSource = dependencies.createDataSource(config.databasePoolSize);
		assertSafeDataSource(dataSource, config.databasePoolSize);
		await dataSource.initialize();
		const readiness = await dependencies.checkReadiness(dataSource, config);
		if (!readiness.ready) {
			writeEvent(dependencies.stderr, {
				event: 'runtime',
				missingRuntimeObjects: readiness.missingRuntimeObjects,
				missingSchemaObjects: readiness.missingSchemaObjects,
				pendingMigrations: readiness.pendingMigrations,
				status: 'not-ready'
			});
			exitCode = 69;
		} else if (!abortController.signal.aborted) {
			const workers = dependencies.composeWorkers(dataSource, config);
			assertWorkerSet(workers, config.workerCount);
			writeEvent(dependencies.stdout, {
				databasePoolSize: config.databasePoolSize,
				event: 'runtime',
				exportTimeoutMs: config.exportTimeoutMilliseconds,
				insertRows: config.insertBatchSize,
				leaseMs: config.leaseDurationMilliseconds,
				status: 'ready',
				storageRoot: config.storageRoot,
				workers: config.workerCount
			});
			started = true;
			workerRuns = workers.map((worker) =>
				dependencies.runWorkerLoop(
					{
						errorBackoffMilliseconds: config.errorBackoffMilliseconds,
						idlePollMilliseconds: config.idlePollMilliseconds
					},
					{
						emit: (event) => writeEvent(dependencies.stdout, event),
						execute: worker.execute,
						formatError: safeMessage,
						now: dependencies.now,
						signal: abortController.signal,
						wait: dependencies.wait,
						workerIndex: worker.workerIndex
					}
				)
			);
			await Promise.all(workerRuns);
		}
	} catch (error) {
		if (!abortController.signal.aborted) abortController.abort(asError(error));
		await Promise.allSettled(workerRuns);
		if (!shutdownRequested) {
			writeEvent(dependencies.stderr, {
				event: 'runtime',
				message: safeMessage(error),
				status: 'failed'
			});
			exitCode = 75;
		}
	} finally {
		if (!abortController.signal.aborted) {
			abortController.abort(new Error('runtime stopped'));
		}
		await Promise.allSettled(workerRuns);
		unregisterSignals();
		if (dataSource?.isInitialized) {
			try {
				await dataSource.destroy();
			} catch (error) {
				writeEvent(dependencies.stderr, {
					event: 'cleanup',
					message: safeMessage(error),
					status: 'failed'
				});
				exitCode = 75;
			}
		}
	}
	if (started && exitCode === 0) {
		writeEvent(dependencies.stdout, {
			event: 'runtime',
			status: 'stopped'
		});
	}
	return exitCode;
}

export function assertSafeFullHistoryStateImportDataSource(
	dataSource: DataSource,
	expectedPoolSize: number
): void {
	assertSafeDataSource(dataSource, expectedPoolSize);
}

function assertSafeDataSource(
	dataSource: DataSource,
	expectedPoolSize: number
): void {
	if (
		dataSource.options.type !== 'postgres' ||
		dataSource.options.migrationsRun === true ||
		dataSource.options.synchronize ||
		dataSource.options.poolSize !== expectedPoolSize ||
		expectedPoolSize > FULL_HISTORY_STATE_IMPORT_MAXIMUM_DATABASE_POOL_SIZE
	) {
		throw new Error('State-import DataSource is not production-safe');
	}
}

function assertWorkerSet(
	workers: readonly FullHistoryStateImportWorker[],
	expectedCount: number
): void {
	const indexes = new Set(workers.map((worker) => worker.workerIndex));
	const ids = new Set(workers.map((worker) => worker.workerId));
	if (
		workers.length !== expectedCount ||
		indexes.size !== expectedCount ||
		ids.size !== expectedCount ||
		workers.some(
			(worker) => worker.workerIndex < 1 || worker.workerIndex > expectedCount
		)
	) {
		throw new Error('State-import worker composition is invalid');
	}
}

function registerSignals(stop: () => void): () => void {
	process.once('SIGINT', stop);
	process.once('SIGTERM', stop);
	return () => {
		process.off('SIGINT', stop);
		process.off('SIGTERM', stop);
	};
}

function writeEvent(
	output: WritableOutput,
	event: FullHistoryStateImportWorkerEvent | Readonly<Record<string, unknown>>
): void {
	const serialized = JSON.stringify(event);
	output.write(
		Buffer.byteLength(serialized) <= maximumOutputBytes
			? `${serialized}\n`
			: '{"event":"runtime","status":"output-bound-exceeded"}\n'
	);
}

function safeMessage(error: unknown): string {
	return replaceControlCharacters(
		error instanceof Error ? error.message : String(error)
	)
		.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database-url-redacted]')
		.slice(0, 512);
}

function replaceControlCharacters(value: string): string {
	return Array.from(value, (character) => {
		const codePoint = character.codePointAt(0)!;
		return codePoint < 32 || codePoint === 127 ? ' ' : character;
	}).join('');
}

function asError(error: unknown): Error {
	return error instanceof Error
		? error
		: new Error('Full-history state-import runtime failed', { cause: error });
}
