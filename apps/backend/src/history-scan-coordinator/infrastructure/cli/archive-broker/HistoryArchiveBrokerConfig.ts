import {
	getHistoryArchiveBrokerMaximumPriority,
	parseHistoryArchiveBrokerMaximumPriority,
	type HistoryArchiveBrokerPriority
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveBrokerPriority.js';

export { parseHistoryArchiveBrokerMaximumPriority };

export interface HistoryArchiveBrokerConfig {
	readonly batchSize: number;
	readonly consumer: string;
	readonly highWatermark: number;
	readonly maximumPerHost: number;
	readonly maximumPriority: HistoryArchiveBrokerPriority;
	readonly pollIntervalMs: number;
	readonly servers: readonly string[];
	readonly stream: string;
	readonly subject: string;
	readonly token: string | undefined;
}

function readPositiveInteger(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 1)
		throw new Error(`${name} must be a positive integer`);
	return value;
}

export function getHistoryArchiveBrokerConfig(): HistoryArchiveBrokerConfig {
	const servers = (process.env.NATS_SERVERS ?? 'nats://127.0.0.1:4222')
		.split(',')
		.map((server) => server.trim())
		.filter((server) => server.length > 0);
	if (servers.length === 0)
		throw new Error('NATS_SERVERS must contain at least one server');
	const token = process.env.NATS_TOKEN?.trim();
	if (!token) throw new Error('NATS_TOKEN is required');

	const highWatermark = readPositiveInteger(
		'HISTORY_ARCHIVE_BROKER_HIGH_WATERMARK',
		64
	);
	return {
		batchSize: Math.min(
			readPositiveInteger('HISTORY_ARCHIVE_BROKER_BATCH_SIZE', 32),
			highWatermark
		),
		consumer:
			process.env.NATS_ARCHIVE_JOB_CONSUMER ??
			'stellaratlas-history-object-workers',
		highWatermark,
		maximumPerHost: readPositiveInteger(
			'HISTORY_ARCHIVE_MAX_ACTIVE_PER_HOST',
			2
		),
		maximumPriority: getHistoryArchiveBrokerMaximumPriority(),
		pollIntervalMs: readPositiveInteger(
			'HISTORY_ARCHIVE_BROKER_POLL_INTERVAL_MS',
			2_000
		),
		servers,
		stream:
			process.env.NATS_ARCHIVE_JOB_STREAM ?? 'STELLARATLAS_HISTORY_OBJECTS',
		subject:
			process.env.NATS_ARCHIVE_JOB_SUBJECT ??
			'stellaratlas.history.object.verify',
		token
	};
}
