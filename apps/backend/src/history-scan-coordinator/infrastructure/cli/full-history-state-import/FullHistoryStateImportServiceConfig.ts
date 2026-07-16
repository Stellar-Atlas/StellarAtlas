import { isAbsolute } from 'node:path';

const enabledEnvironmentKey = 'FULL_HISTORY_STATE_IMPORT_ENABLED';

export const FULL_HISTORY_STATE_IMPORT_DEFAULT_STORAGE_ROOT =
	'/home/observe/stellarbeat-data/full-history/typed';
export const FULL_HISTORY_STATE_IMPORT_DEFAULT_EXECUTABLE =
	'/home/observe/stellarbeat-data/Observer/apps/full-history-etl/bin/stellaratlas-full-history-state-export';
export const FULL_HISTORY_STATE_IMPORT_MAXIMUM_WORKERS = 4;
export const FULL_HISTORY_STATE_IMPORT_MAXIMUM_EXPORT_PROCESSES = 3;
export const FULL_HISTORY_STATE_IMPORT_MAXIMUM_DATABASE_POOL_SIZE = 6;

export interface FullHistoryStateImportServiceConfig {
	readonly databasePoolSize: number;
	readonly errorBackoffMilliseconds: number;
	readonly executablePath: string;
	readonly exportProcessCount: number;
	readonly exportTimeoutMilliseconds: number;
	readonly idlePollMilliseconds: number;
	readonly insertBatchSize: number;
	readonly leaseDurationMilliseconds: number;
	readonly storageRoot: string;
	readonly workerCount: number;
}

export function parseFullHistoryStateImportServiceConfig(
	environment: NodeJS.ProcessEnv
): FullHistoryStateImportServiceConfig {
	if (environment[enabledEnvironmentKey] !== 'true') {
		throw new Error(`${enabledEnvironmentKey} must equal true`);
	}
	const workerCount = readInteger(
		environment.FULL_HISTORY_STATE_IMPORT_WORKERS,
		4,
		1,
		FULL_HISTORY_STATE_IMPORT_MAXIMUM_WORKERS,
		'FULL_HISTORY_STATE_IMPORT_WORKERS'
	);
	const maximumExportProcesses = Math.min(
		workerCount,
		FULL_HISTORY_STATE_IMPORT_MAXIMUM_EXPORT_PROCESSES
	);
	return Object.freeze({
		databasePoolSize: workerCount + 2,
		errorBackoffMilliseconds: readInteger(
			environment.FULL_HISTORY_STATE_IMPORT_ERROR_BACKOFF_MS,
			30_000,
			1_000,
			300_000,
			'FULL_HISTORY_STATE_IMPORT_ERROR_BACKOFF_MS'
		),
		executablePath: readAbsolutePath(
			environment.FULL_HISTORY_STATE_EXPORT_EXECUTABLE,
			FULL_HISTORY_STATE_IMPORT_DEFAULT_EXECUTABLE,
			'FULL_HISTORY_STATE_EXPORT_EXECUTABLE'
		),
		exportProcessCount: readInteger(
			environment.FULL_HISTORY_STATE_EXPORT_PROCESSES,
			maximumExportProcesses,
			1,
			maximumExportProcesses,
			'FULL_HISTORY_STATE_EXPORT_PROCESSES'
		),
		exportTimeoutMilliseconds: readInteger(
			environment.FULL_HISTORY_STATE_EXPORT_TIMEOUT_MS,
			30 * 60_000,
			1_000,
			86_400_000,
			'FULL_HISTORY_STATE_EXPORT_TIMEOUT_MS'
		),
		idlePollMilliseconds: readInteger(
			environment.FULL_HISTORY_STATE_IMPORT_IDLE_POLL_MS,
			15_000,
			1_000,
			300_000,
			'FULL_HISTORY_STATE_IMPORT_IDLE_POLL_MS'
		),
		insertBatchSize: readInteger(
			environment.FULL_HISTORY_STATE_IMPORT_INSERT_ROWS,
			250,
			1,
			500,
			'FULL_HISTORY_STATE_IMPORT_INSERT_ROWS'
		),
		leaseDurationMilliseconds: readInteger(
			environment.FULL_HISTORY_STATE_IMPORT_LEASE_MS,
			10 * 60_000,
			10_000,
			30 * 60_000,
			'FULL_HISTORY_STATE_IMPORT_LEASE_MS'
		),
		storageRoot: readAbsolutePath(
			environment.FULL_HISTORY_STATE_IMPORT_STORAGE_ROOT,
			FULL_HISTORY_STATE_IMPORT_DEFAULT_STORAGE_ROOT,
			'FULL_HISTORY_STATE_IMPORT_STORAGE_ROOT'
		),
		workerCount
	});
}

function readInteger(
	value: string | undefined,
	fallback: number,
	minimum: number,
	maximum: number,
	name: string
): number {
	if (value === undefined) return fallback;
	if (!/^[0-9]+$/.test(value)) {
		throw new Error(`${name} must be an integer`);
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
		throw new Error(`${name} must be between ${minimum} and ${maximum}`);
	}
	return parsed;
}

function readAbsolutePath(
	value: string | undefined,
	fallback: string,
	name: string
): string {
	const selected = value ?? fallback;
	if (
		selected.length === 0 ||
		selected !== selected.trim() ||
		selected.includes('\0') ||
		Buffer.byteLength(selected) > 4_096 ||
		!isAbsolute(selected)
	) {
		throw new Error(`${name} must be a bounded absolute path`);
	}
	return selected;
}
