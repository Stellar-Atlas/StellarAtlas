import { config } from 'dotenv';
import { err, ok, Result } from 'neverthrow';
import { availableParallelism } from 'node:os';
import { dirname, resolve } from 'node:path';
import { resolveAppEnvPath } from 'shared/lib/env/resolve-app-env-path.js';

const envPath = resolveAppEnvPath(import.meta.url, 'history-scanner');

config({
	path: envPath,
	quiet: true
});

export interface Config {
	nodeEnv: string;
	enableSentry: boolean;
	sentryDSN?: string;
	userAgent: string;
	coordinatorAPIBaseUrl: string;
	coordinatorAPIPassword: string;
	coordinatorAPIUsername: string;
	logLevel: string;
	historyMaxFileMs: number;
	historySlowArchiveMaxLedgers: number;
	historyHasherWorkers: number;
	historyMaxRequests: number;
	historyBucketCacheDir: string;
	historyBucketCacheMaxBytes: number;
}

// Simple boolean parser to replace 'yn'
function parseBoolean(val: string | undefined): boolean | undefined {
	if (typeof val !== 'string') return undefined;
	const normalized = val.trim().toLowerCase();
	if (['y', 'yes', 'true', '1', 'on'].includes(normalized)) return true;
	if (['n', 'no', 'false', '0', 'off'].includes(normalized)) return false;
	return undefined;
}

// Default values
const defaultConfig = {
	nodeEnv: 'development',
	enableSentry: false,
	userAgent: 'stellaratlas-history-scanner',
	logLevel: 'info',
	historyMaxFileMs: 60000,
	historySlowArchiveMaxLedgers: 1000,
	historyMaxRequests: 24,
	historyBucketCacheDir: resolve(dirname(envPath), '..', '..', 'history-bucket-cache'),
	historyBucketCacheMaxBytes: 10 * 1024 * 1024 * 1024 * 1024
};

const maxHistoryHasherWorkers = 24;
const maxHistoryParallelRequests = 24;

export function calculateDefaultHistoryHasherWorkers(
	historyScanWorkers: number,
	cpuCount: number
): number {
	const scanWorkerCount = Math.max(Math.floor(historyScanWorkers), 1);
	const availableCpuCount = Math.max(cpuCount - 1, 1);
	const workerCount = Math.floor(availableCpuCount / scanWorkerCount);
	return Math.min(Math.max(workerCount, 1), maxHistoryHasherWorkers);
}

function parseOptionalPositiveInteger(
	name: string,
	maximum?: number
): Result<number | undefined, Error> {
	const value = process.env[name];
	if (value === undefined || value.trim() === '') return ok(undefined);

	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		return err(new Error(`${name} must be a positive integer`));
	}

	if (maximum !== undefined && parsed > maximum) {
		return err(new Error(`${name} must be between 1 and ${maximum}`));
	}

	return ok(parsed);
}

function parseOptionalPositiveNumber(name: string): Result<number | undefined, Error> {
	const value = process.env[name];
	if (value === undefined || value.trim() === '') return ok(undefined);

	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return err(new Error(`${name} must be a positive number`));
	}

	return ok(parsed);
}

export function getConfigFromEnv(): Result<Config, Error> {
	// Required env vars validation
	const required = [
		'COORDINATOR_API_BASE_URL',
		'COORDINATOR_API_USERNAME',
		'COORDINATOR_API_PASSWORD'
	];

	const missing = required.filter((key) => !process.env[key]);
	if (missing.length) {
		return err(new Error(`Missing required env vars: ${missing.join(', ')}`));
	}

	// Optional vars with validation
	const enableSentry =
		parseBoolean(process.env.ENABLE_SENTRY) ?? defaultConfig.enableSentry;
	if (enableSentry && !process.env.SENTRY_DSN) {
		return err(new Error('SENTRY_DSN required when ENABLE_SENTRY is true'));
	}

	const historyMaxFileMs = process.env.HISTORY_MAX_FILE_MS
		? Number(process.env.HISTORY_MAX_FILE_MS)
		: defaultConfig.historyMaxFileMs;

	if (isNaN(historyMaxFileMs)) {
		return err(new Error('HISTORY_MAX_FILE_MS must be a number'));
	}

	const historySlowArchiveMaxLedgers = process.env
		.HISTORY_SLOW_ARCHIVE_MAX_LEDGERS
		? Number(process.env.HISTORY_SLOW_ARCHIVE_MAX_LEDGERS)
		: defaultConfig.historySlowArchiveMaxLedgers;

	if (isNaN(historySlowArchiveMaxLedgers)) {
		return err(new Error('HISTORY_SLOW_ARCHIVE_MAX_LEDGERS must be a number'));
	}

	const historyScanWorkersResult =
		parseOptionalPositiveInteger('HISTORY_SCAN_WORKERS');
	if (historyScanWorkersResult.isErr()) return err(historyScanWorkersResult.error);

	const historyHasherWorkersResult = parseOptionalPositiveInteger(
		'HISTORY_HASHER_WORKERS',
		maxHistoryHasherWorkers
	);
	if (historyHasherWorkersResult.isErr())
		return err(historyHasherWorkersResult.error);

	const historyMaxRequestsResult = parseOptionalPositiveInteger(
		'HISTORY_MAX_REQUESTS',
		maxHistoryParallelRequests
	);
	if (historyMaxRequestsResult.isErr())
		return err(historyMaxRequestsResult.error);

	const historyBucketCacheMaxBytesResult = parseOptionalPositiveNumber(
		'HISTORY_BUCKET_CACHE_MAX_BYTES'
	);
	if (historyBucketCacheMaxBytesResult.isErr())
		return err(historyBucketCacheMaxBytesResult.error);

	const historyScanWorkers = historyScanWorkersResult.value ?? 1;
	const historyMaxRequests =
		historyMaxRequestsResult.value ?? defaultConfig.historyMaxRequests;
	const historyHasherWorkers =
		historyHasherWorkersResult.value ??
		calculateDefaultHistoryHasherWorkers(
			historyScanWorkers,
			availableParallelism()
		);

	return ok({
		nodeEnv: process.env.NODE_ENV ?? defaultConfig.nodeEnv,
		enableSentry,
		sentryDSN: enableSentry ? process.env.SENTRY_DSN : undefined,
		userAgent: process.env.USER_AGENT ?? defaultConfig.userAgent,
		coordinatorAPIBaseUrl: process.env.COORDINATOR_API_BASE_URL!,
		coordinatorAPIPassword: process.env.COORDINATOR_API_PASSWORD!,
		coordinatorAPIUsername: process.env.COORDINATOR_API_USERNAME!,
		logLevel: process.env.LOG_LEVEL ?? defaultConfig.logLevel,
		historyMaxFileMs,
		historySlowArchiveMaxLedgers,
		historyHasherWorkers,
		historyMaxRequests,
		historyBucketCacheDir:
			process.env.HISTORY_BUCKET_CACHE_DIR ??
			defaultConfig.historyBucketCacheDir,
		historyBucketCacheMaxBytes:
			historyBucketCacheMaxBytesResult.value ??
			defaultConfig.historyBucketCacheMaxBytes
	});
}
