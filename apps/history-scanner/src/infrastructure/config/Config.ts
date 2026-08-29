import { config } from 'dotenv';
import { err, ok, Result } from 'neverthrow';
import { availableParallelism } from 'node:os';
import { dirname, resolve } from 'node:path';
import { resolveAppEnvPath } from 'shared/lib/env/resolve-app-env-path.js';
import { historyArchiveWorkerSlotLimit } from 'history-scanner-dto';
import {
	type CoordinatorAuthConfig,
	isCoordinatorAuthMode
} from './CoordinatorAuthConfig.js';
import type { HistoryArchiveIoPressureAdmissionConfig } from '../services/LinuxIoPressureAdmission.js';

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
	coordinatorAuth: CoordinatorAuthConfig;
	logLevel: string;
	historyMaxFileMs: number;
	historySlowArchiveMaxLedgers: number;
	historyScanWorkers: number;
	historyHasherWorkers: number;
	historyMaxRequests: number;
	historyScanRangeSize: number;
	historyBucketCacheDir: string;
	historyBucketCacheMaxBytes: number;
	historyArchiveContentReuseEnabled: boolean;
	historyArchiveParsedHistoryEnabled: boolean;
	historyArchiveObjectJobSource: 'nats' | 'legacy-http';
	natsArchiveJobConsumer: string;
	natsArchiveJobStream: string;
	natsArchiveJobSubject: string;
	natsServers: readonly string[];
	natsToken: string | undefined;
	historyArchiveIoPressureAdmission: HistoryArchiveIoPressureAdmissionConfig;
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
	historyScanRangeSize: 250000,
	historyBucketCacheDir: resolve(
		dirname(envPath),
		'..',
		'..',
		'history-bucket-cache'
	),
	historyBucketCacheMaxBytes: 10 * 1024 * 1024 * 1024 * 1024,
	historyArchiveContentReuseEnabled: true,
	historyArchiveParsedHistoryEnabled: false,
	historyArchiveObjectJobSource: 'legacy-http' as const,
	natsArchiveJobConsumer: 'stellaratlas-history-object-workers',
	natsArchiveJobStream: 'STELLARATLAS_HISTORY_OBJECTS',
	natsArchiveJobSubject: 'stellaratlas.history.object.verify',
	natsServers: ['nats://127.0.0.1:4222'] as const,
	historyArchiveIoPressureAdmission: {
		enabled: false,
		fullAvg10Maximum: 5,
		healthySamplesRequired: 1,
		md0InflightMaximum: null,
		retryIntervalMs: 10_000,
		someAvg10Maximum: 25
	}
};

const maxHistoryHasherWorkers = historyArchiveWorkerSlotLimit - 1;
const maxHistoryParallelRequests = 24;
const maxHistoryScanWorkers = 24;

export function calculateDefaultHistoryHasherWorkers(
	historyScanWorkers: number,
	cpuCount: number
): number {
	const availableCpuCount = Math.max(cpuCount - 1, 1);
	return calculatePerScannerWorkerConcurrency(
		Math.min(availableCpuCount, maxHistoryHasherWorkers),
		historyScanWorkers
	);
}

export function calculatePerScannerWorkerConcurrency(
	totalWorkers: number,
	historyScanWorkers: number
): number {
	const scanWorkerCount = Math.max(Math.floor(historyScanWorkers), 1);
	const workerCount = Math.max(Math.floor(totalWorkers), 1);
	return Math.max(Math.floor(workerCount / scanWorkerCount), 1);
}

export function calculatePerScannerRequestConcurrency(
	totalRequests: number,
	historyScanWorkers: number
): number {
	const requestCount = Math.max(Math.floor(totalRequests), 1);
	const scanWorkerCount = Math.max(Math.floor(historyScanWorkers), 1);
	return Math.max(Math.floor(requestCount / scanWorkerCount), 1);
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

function parseOptionalPositiveNumber(
	name: string
): Result<number | undefined, Error> {
	const value = process.env[name];
	if (value === undefined || value.trim() === '') return ok(undefined);

	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return err(new Error(`${name} must be a positive number`));
	}

	return ok(parsed);
}

function parseIoPressureAdmissionConfig(
	jobSource: Config['historyArchiveObjectJobSource']
): Result<HistoryArchiveIoPressureAdmissionConfig, Error> {
	const defaults = defaultConfig.historyArchiveIoPressureAdmission;
	if (jobSource !== 'nats') return ok(defaults);

	const enabledName = 'HISTORY_ARCHIVE_IO_PRESSURE_ADMISSION_ENABLED';
	const enabledValue = process.env[enabledName];
	const enabled =
		enabledValue === undefined ? defaults.enabled : parseBoolean(enabledValue);
	if (enabled === undefined) {
		return err(new Error(`${enabledName} must be true or false`));
	}

	const fullResult = parseOptionalBoundedNumber(
		'HISTORY_ARCHIVE_IO_PRESSURE_FULL_AVG10_MAX',
		0,
		100
	);
	if (fullResult.isErr()) return err(fullResult.error);
	const someResult = parseOptionalBoundedNumber(
		'HISTORY_ARCHIVE_IO_PRESSURE_SOME_AVG10_MAX',
		0,
		100
	);
	if (someResult.isErr()) return err(someResult.error);
	const retryResult = parseOptionalBoundedInteger(
		'HISTORY_ARCHIVE_IO_PRESSURE_RETRY_MS',
		1_000,
		60_000
	);
	if (retryResult.isErr()) return err(retryResult.error);
	const healthySamplesResult = parseOptionalBoundedInteger(
		'HISTORY_ARCHIVE_IO_PRESSURE_HEALTHY_SAMPLES_REQUIRED',
		1,
		60
	);
	if (healthySamplesResult.isErr()) return err(healthySamplesResult.error);
	const md0InflightResult = parseOptionalBoundedInteger(
		'HISTORY_ARCHIVE_IO_PRESSURE_MD0_INFLIGHT_MAX',
		0,
		1_000_000
	);
	if (md0InflightResult.isErr()) return err(md0InflightResult.error);

	return ok({
		enabled,
		fullAvg10Maximum: fullResult.value ?? defaults.fullAvg10Maximum,
		healthySamplesRequired:
			healthySamplesResult.value ?? defaults.healthySamplesRequired,
		md0InflightMaximum: md0InflightResult.value ?? defaults.md0InflightMaximum,
		retryIntervalMs: retryResult.value ?? defaults.retryIntervalMs,
		someAvg10Maximum: someResult.value ?? defaults.someAvg10Maximum
	});
}

function parseOptionalBoundedNumber(
	name: string,
	minimum: number,
	maximum: number
): Result<number | undefined, Error> {
	const value = process.env[name];
	if (value === undefined) return ok(undefined);
	const normalized = value.trim();
	if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized))
		return err(new Error(`${name} must be between ${minimum} and ${maximum}`));

	const parsed = Number(normalized);
	if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
		return err(new Error(`${name} must be between ${minimum} and ${maximum}`));
	}
	return ok(parsed);
}

function parseOptionalBoundedInteger(
	name: string,
	minimum: number,
	maximum: number
): Result<number | undefined, Error> {
	const result = parseOptionalBoundedNumber(name, minimum, maximum);
	if (result.isErr() || result.value === undefined) return result;
	if (!Number.isInteger(result.value)) {
		return err(
			new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
		);
	}
	return result;
}

export function getConfigFromEnv(): Result<Config, Error> {
	// Required env vars validation
	const required = ['COORDINATOR_API_BASE_URL'];

	const missing = required.filter((key) => !process.env[key]);
	if (missing.length) {
		return err(new Error(`Missing required env vars: ${missing.join(', ')}`));
	}

	const coordinatorAuthResult = getCoordinatorAuthFromEnv();
	if (coordinatorAuthResult.isErr()) return err(coordinatorAuthResult.error);

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

	const historyScanWorkersResult = parseOptionalPositiveInteger(
		'HISTORY_SCAN_WORKERS',
		maxHistoryScanWorkers
	);
	if (historyScanWorkersResult.isErr())
		return err(historyScanWorkersResult.error);

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

	const historyScanRangeSizeResult = parseOptionalPositiveInteger(
		'HISTORY_SCAN_RANGE_SIZE'
	);
	if (historyScanRangeSizeResult.isErr())
		return err(historyScanRangeSizeResult.error);

	const historyBucketCacheMaxBytesResult = parseOptionalPositiveNumber(
		'HISTORY_BUCKET_CACHE_MAX_BYTES'
	);
	if (historyBucketCacheMaxBytesResult.isErr())
		return err(historyBucketCacheMaxBytesResult.error);

	const contentReuseValue = process.env.HISTORY_ARCHIVE_CONTENT_REUSE_ENABLED;
	const historyArchiveContentReuseEnabled =
		contentReuseValue === undefined
			? defaultConfig.historyArchiveContentReuseEnabled
			: parseBoolean(contentReuseValue);
	if (historyArchiveContentReuseEnabled === undefined) {
		return err(
			new Error('HISTORY_ARCHIVE_CONTENT_REUSE_ENABLED must be true or false')
		);
	}

	const parsedHistoryValue = process.env.HISTORY_ARCHIVE_PARSED_HISTORY_ENABLED;
	const historyArchiveParsedHistoryEnabled =
		parsedHistoryValue === undefined
			? defaultConfig.historyArchiveParsedHistoryEnabled
			: parseBoolean(parsedHistoryValue);
	if (historyArchiveParsedHistoryEnabled === undefined) {
		return err(
			new Error('HISTORY_ARCHIVE_PARSED_HISTORY_ENABLED must be true or false')
		);
	}

	const historyArchiveObjectJobSource =
		process.env.HISTORY_ARCHIVE_OBJECT_JOB_SOURCE ??
		defaultConfig.historyArchiveObjectJobSource;
	if (
		historyArchiveObjectJobSource !== 'nats' &&
		historyArchiveObjectJobSource !== 'legacy-http'
	) {
		return err(
			new Error('HISTORY_ARCHIVE_OBJECT_JOB_SOURCE must be nats or legacy-http')
		);
	}
	const natsServers = (
		process.env.NATS_SERVERS ?? defaultConfig.natsServers.join(',')
	)
		.split(',')
		.map((server) => server.trim())
		.filter((server) => server.length > 0);
	if (natsServers.length === 0)
		return err(new Error('NATS_SERVERS must contain at least one server'));
	const natsToken = process.env.NATS_TOKEN?.trim();
	if (historyArchiveObjectJobSource === 'nats' && !natsToken) {
		return err(
			new Error(
				'NATS_TOKEN is required when HISTORY_ARCHIVE_OBJECT_JOB_SOURCE is nats'
			)
		);
	}
	const ioPressureAdmissionResult = parseIoPressureAdmissionConfig(
		historyArchiveObjectJobSource
	);
	if (ioPressureAdmissionResult.isErr())
		return err(ioPressureAdmissionResult.error);

	const historyScanWorkers = historyScanWorkersResult.value ?? 1;
	const historyMaxRequests =
		historyMaxRequestsResult.value ?? defaultConfig.historyMaxRequests;
	const historyPerScannerMaxRequests = calculatePerScannerRequestConcurrency(
		historyMaxRequests,
		historyScanWorkers
	);
	const historyTotalHasherWorkers =
		historyHasherWorkersResult.value ??
		Math.min(Math.max(availableParallelism() - 1, 1), maxHistoryHasherWorkers);
	const historyHasherWorkers = calculatePerScannerWorkerConcurrency(
		historyTotalHasherWorkers,
		historyScanWorkers
	);

	return ok({
		nodeEnv: process.env.NODE_ENV ?? defaultConfig.nodeEnv,
		enableSentry,
		sentryDSN: enableSentry ? process.env.SENTRY_DSN : undefined,
		userAgent: process.env.USER_AGENT ?? defaultConfig.userAgent,
		coordinatorAPIBaseUrl: process.env.COORDINATOR_API_BASE_URL!,
		coordinatorAuth: coordinatorAuthResult.value,
		logLevel: process.env.LOG_LEVEL ?? defaultConfig.logLevel,
		historyMaxFileMs,
		historySlowArchiveMaxLedgers,
		historyScanWorkers,
		historyHasherWorkers,
		historyMaxRequests: historyPerScannerMaxRequests,
		historyScanRangeSize:
			historyScanRangeSizeResult.value ?? defaultConfig.historyScanRangeSize,
		historyBucketCacheDir:
			process.env.HISTORY_BUCKET_CACHE_DIR ??
			defaultConfig.historyBucketCacheDir,
		historyBucketCacheMaxBytes:
			historyBucketCacheMaxBytesResult.value ??
			defaultConfig.historyBucketCacheMaxBytes,
		historyArchiveContentReuseEnabled,
		historyArchiveParsedHistoryEnabled,
		historyArchiveObjectJobSource,
		natsArchiveJobConsumer:
			process.env.NATS_ARCHIVE_JOB_CONSUMER ??
			defaultConfig.natsArchiveJobConsumer,
		natsArchiveJobStream:
			process.env.NATS_ARCHIVE_JOB_STREAM ?? defaultConfig.natsArchiveJobStream,
		natsArchiveJobSubject:
			process.env.NATS_ARCHIVE_JOB_SUBJECT ??
			defaultConfig.natsArchiveJobSubject,
		natsServers,
		natsToken,
		historyArchiveIoPressureAdmission: ioPressureAdmissionResult.value
	});
}

function getCoordinatorAuthFromEnv(): Result<CoordinatorAuthConfig, Error> {
	const mode = process.env.COORDINATOR_AUTH_MODE ?? 'internal';
	if (!isCoordinatorAuthMode(mode)) {
		return err(
			new Error('COORDINATOR_AUTH_MODE must be internal or community')
		);
	}

	if (mode === 'community') return getCommunityCoordinatorAuthFromEnv();

	return getInternalCoordinatorAuthFromEnv();
}

function getInternalCoordinatorAuthFromEnv(): Result<
	CoordinatorAuthConfig,
	Error
> {
	const required = ['COORDINATOR_API_USERNAME', 'COORDINATOR_API_PASSWORD'];
	const missing = required.filter((key) => !process.env[key]);
	if (missing.length) {
		return err(new Error(`Missing required env vars: ${missing.join(', ')}`));
	}

	return ok({
		type: 'internal',
		username: process.env.COORDINATOR_API_USERNAME!,
		password: process.env.COORDINATOR_API_PASSWORD!
	});
}

function getCommunityCoordinatorAuthFromEnv(): Result<
	CoordinatorAuthConfig,
	Error
> {
	const required = ['COMMUNITY_SCANNER_ID', 'COMMUNITY_SCANNER_API_KEY'];
	const missing = required.filter((key) => !process.env[key]);
	if (missing.length) {
		return err(new Error(`Missing required env vars: ${missing.join(', ')}`));
	}

	return ok({
		type: 'community',
		scannerId: process.env.COMMUNITY_SCANNER_ID!,
		apiKey: process.env.COMMUNITY_SCANNER_API_KEY!
	});
}
