import { dirname, relative, resolve, sep } from 'node:path';

const maximumIngressBytesPerSecond = 187_500_000;
const maximumFetchConcurrency = 12;
const maximumProcessingConcurrency = 8;
const minimumTypedShardLedgers = 64;
const maximumTypedShardLedgers = 1_024;
const maximumCycleLedgers = 65_536;
const sharedMemoryRoot = '/dev/shm';

export interface FullHistoryLedgerCloseMetaServiceConfig {
	readonly bulkRoot: string;
	readonly cycleLedgerCount: number;
	readonly errorBackoffMilliseconds: number;
	readonly executablePath: string;
	readonly fetchConcurrency: number;
	readonly firstAvailableLedger: number;
	readonly idlePollMilliseconds: number;
	readonly ingressBytesPerSecond: number;
	readonly ingressBurstBytes: number;
	readonly minimumFreeBytes: bigint;
	readonly minimumFreeBasisPoints: number;
	readonly maximumStoredBytes: bigint;
	readonly networkName: string;
	readonly networkPassphrase: string;
	readonly processingConcurrency: number;
	readonly processTimeoutMilliseconds: number;
	readonly requestTimeoutMilliseconds: number;
	readonly s3Bucket: string;
	readonly s3Region: string;
	readonly sourceBaseUrl: string;
	readonly sourceLedgersPath: string;
	readonly temporaryInputRoot: string;
	readonly typedOutputRoot: string;
	readonly typedShardLedgerCount: number;
}

export function parseFullHistoryLedgerCloseMetaServiceConfig(
	environment: NodeJS.ProcessEnv
): FullHistoryLedgerCloseMetaServiceConfig {
	if (environment.FULL_HISTORY_LEDGER_CLOSE_META_ENABLED !== 'true') {
		throw new Error('FULL_HISTORY_LEDGER_CLOSE_META_ENABLED must equal true');
	}
	const bulkRoot = absolutePath(
		environment.FULL_HISTORY_BULK_ROOT ?? '/home/observe/stellarbeat-data',
		'bulk storage root'
	);
	const typedOutputRoot = absolutePath(
		environment.FULL_HISTORY_LEDGER_CLOSE_META_TYPED_ROOT ??
			'/home/observe/stellarbeat-data/full-history/typed',
		'typed output root'
	);
	if (!isChild(bulkRoot, typedOutputRoot)) {
		throw new Error('typed output root must be inside the bulk storage root');
	}
	const temporaryInputRoot = absolutePath(
		environment.FULL_HISTORY_LEDGER_CLOSE_META_TEMP_ROOT ??
			'/dev/shm/stellaratlas-full-history-etl',
		'temporary input root'
	);
	if (!isChild(sharedMemoryRoot, temporaryInputRoot)) {
		throw new Error('temporary input root must be a strict child of /dev/shm');
	}
	assertDistinctRoots(temporaryInputRoot, typedOutputRoot);
	const ingressBytesPerSecond = integer(
		environment.FULL_HISTORY_LEDGER_CLOSE_META_INGRESS_BYTES_PER_SECOND,
		maximumIngressBytesPerSecond,
		1,
		maximumIngressBytesPerSecond,
		'ingress bytes per second'
	);
	const typedShardLedgerCount = integer(
		environment.FULL_HISTORY_LEDGER_CLOSE_META_SHARD_LEDGERS,
		maximumTypedShardLedgers,
		minimumTypedShardLedgers,
		maximumTypedShardLedgers,
		'typed shard ledgers'
	);
	const cycleLedgerCount = integer(
		environment.FULL_HISTORY_LEDGER_CLOSE_META_CYCLE_LEDGERS,
		typedShardLedgerCount * 8,
		typedShardLedgerCount,
		maximumCycleLedgers,
		'cycle ledgers'
	);
	if (cycleLedgerCount % typedShardLedgerCount !== 0) {
		throw new Error('cycle ledgers must contain whole typed shards');
	}
	return Object.freeze({
		bulkRoot,
		cycleLedgerCount,
		errorBackoffMilliseconds: integer(
			environment.FULL_HISTORY_LEDGER_CLOSE_META_ERROR_BACKOFF_MS,
			30_000,
			1_000,
			300_000,
			'error backoff'
		),
		executablePath: absolutePath(
			environment.FULL_HISTORY_LEDGER_CLOSE_META_EXECUTABLE ??
				'/home/observe/stellarbeat-data/Observer/apps/full-history-etl/bin/stellaratlas-full-history-etl',
			'ETL executable'
		),
		fetchConcurrency: integer(
			environment.FULL_HISTORY_LEDGER_CLOSE_META_FETCH_CONCURRENCY,
			12,
			1,
			maximumFetchConcurrency,
			'fetch concurrency'
		),
		firstAvailableLedger: integer(
			environment.FULL_HISTORY_LEDGER_CLOSE_META_FIRST_LEDGER,
			3,
			1,
			0xffff_ffff,
			'first available ledger'
		),
		idlePollMilliseconds: integer(
			environment.FULL_HISTORY_LEDGER_CLOSE_META_IDLE_POLL_MS,
			30_000,
			1_000,
			300_000,
			'idle poll'
		),
		ingressBytesPerSecond,
		ingressBurstBytes: integer(
			environment.FULL_HISTORY_LEDGER_CLOSE_META_INGRESS_BURST_BYTES,
			18_750_000,
			1,
			ingressBytesPerSecond,
			'ingress burst bytes'
		),
		minimumFreeBytes: positiveBigInt(
			environment.FULL_HISTORY_LEDGER_CLOSE_META_MINIMUM_FREE_BYTES,
			5n * 1_024n ** 4n,
			'minimum free bytes'
		),
		minimumFreeBasisPoints: integer(
			environment.FULL_HISTORY_LEDGER_CLOSE_META_MINIMUM_FREE_BASIS_POINTS,
			1_000,
			0,
			10_000,
			'minimum free basis points'
		),
		maximumStoredBytes: positiveBigInt(
			environment.FULL_HISTORY_LEDGER_CLOSE_META_MAXIMUM_STORED_BYTES,
			40n * 1_024n ** 4n,
			'maximum stored bytes'
		),
		networkName: boundedName(
			environment.FULL_HISTORY_LEDGER_CLOSE_META_NETWORK_NAME ?? 'pubnet',
			'network name'
		),
		networkPassphrase: boundedText(
			environment.FULL_HISTORY_NETWORK_PASSPHRASE,
			'network passphrase',
			1_024
		),
		processingConcurrency: integer(
			environment.FULL_HISTORY_LEDGER_CLOSE_META_PROCESSING_CONCURRENCY,
			8,
			1,
			maximumProcessingConcurrency,
			'processing concurrency'
		),
		processTimeoutMilliseconds: integer(
			environment.FULL_HISTORY_LEDGER_CLOSE_META_PROCESS_TIMEOUT_MS,
			3_600_000,
			60_000,
			3_600_000,
			'process timeout'
		),
		requestTimeoutMilliseconds: integer(
			environment.FULL_HISTORY_LEDGER_CLOSE_META_REQUEST_TIMEOUT_MS,
			60_000,
			5_000,
			300_000,
			'request timeout'
		),
		s3Bucket: boundedName(
			environment.FULL_HISTORY_LEDGER_CLOSE_META_S3_BUCKET ??
				'aws-public-blockchain',
			'S3 bucket'
		),
		s3Region: boundedName(
			environment.FULL_HISTORY_LEDGER_CLOSE_META_S3_REGION ?? 'us-east-2',
			'S3 region'
		),
		sourceBaseUrl: httpsUrl(
			environment.FULL_HISTORY_LEDGER_CLOSE_META_SOURCE_BASE_URL ??
				'https://aws-public-blockchain.s3.us-east-2.amazonaws.com'
		),
		sourceLedgersPath: boundedText(
			environment.FULL_HISTORY_LEDGER_CLOSE_META_LEDGERS_PATH ??
				'v1.1/stellar/ledgers/pubnet',
			'ledger path',
			1_024
		),
		temporaryInputRoot,
		typedOutputRoot,
		typedShardLedgerCount
	});
}

function integer(
	value: string | undefined,
	fallback: number,
	minimum: number,
	maximum: number,
	field: string
): number {
	const parsed = value === undefined ? fallback : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
		throw new Error(
			`${field} must be an integer between ${minimum} and ${maximum}`
		);
	}
	return parsed;
}

function positiveBigInt(
	value: string | undefined,
	fallback: bigint,
	field: string
): bigint {
	if (value === undefined) return fallback;
	if (!/^[1-9][0-9]{0,19}$/.test(value)) {
		throw new Error(`${field} must be a positive decimal integer`);
	}
	return BigInt(value);
}

function absolutePath(value: string, field: string): string {
	if (value.length === 0 || value.length > 4_096 || !value.startsWith('/')) {
		throw new Error(`${field} must be a bounded absolute path`);
	}
	const path = resolve(value);
	if (path === dirname(path))
		throw new Error(`${field} cannot be filesystem root`);
	return path;
}

function assertDistinctRoots(temporary: string, typed: string): void {
	if (
		temporary === typed ||
		isChild(temporary, typed) ||
		isChild(typed, temporary)
	) {
		throw new Error('temporary input and typed output roots must be disjoint');
	}
}

function isChild(parent: string, candidate: string): boolean {
	const child = relative(parent, candidate);
	return child.length > 0 && child !== '..' && !child.startsWith(`..${sep}`);
}

function boundedName(value: string, field: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
		throw new Error(`${field} is invalid`);
	}
	return value;
}

function boundedText(
	value: string | undefined,
	field: string,
	maximumBytes: number
): string {
	if (
		value === undefined ||
		value.trim().length === 0 ||
		Buffer.byteLength(value, 'utf8') > maximumBytes
	) {
		throw new Error(`${field} is required and must be bounded`);
	}
	return value;
}

function httpsUrl(value: string): string {
	const url = new URL(value);
	if (
		url.protocol !== 'https:' ||
		url.username.length > 0 ||
		url.password.length > 0 ||
		url.search.length > 0 ||
		url.hash.length > 0
	) {
		throw new Error('source base URL must be credential-free HTTPS');
	}
	return url.href.replace(/\/$/, '');
}
