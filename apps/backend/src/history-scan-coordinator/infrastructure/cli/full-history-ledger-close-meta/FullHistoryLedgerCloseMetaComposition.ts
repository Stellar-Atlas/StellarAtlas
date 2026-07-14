import { DataSource } from 'typeorm';
import { AppDataSource } from '@core/infrastructure/database/AppDataSource.js';
import {
	FULL_HISTORY_LEDGER_CLOSE_META_SHARD_COMPRESSED_BYTES_LIMIT,
	FULL_HISTORY_LEDGER_CLOSE_META_TYPED_SHARD_LEDGER_MINIMUM,
	IngestFullHistoryLedgerCloseMeta
} from '../../../use-cases/ingest-full-history-ledger-close-meta/IngestFullHistoryLedgerCloseMeta.js';
import { TypeOrmFullHistoryLedgerCloseMetaManifestRepository } from '../../database/full-history-ledger-close-meta/TypeOrmFullHistoryLedgerCloseMetaManifestRepository.js';
import {
	AnonymousHttpSep54LedgerCloseMetaSource,
	AnonymousHttpSep54SourceError
} from '../../full-history-ledger-close-meta/AnonymousHttpSep54LedgerCloseMetaSource.js';
import { AnonymousS3Sep54LedgerCloseMetaFrontier } from '../../full-history-ledger-close-meta/AnonymousS3Sep54LedgerCloseMetaFrontier.js';
import { AggregateIngressByteRateLimiter } from '../../full-history-ledger-close-meta/AggregateIngressByteRateLimiter.js';
import {
	FullHistoryBulkStorageBudget,
	type FullHistoryBulkStorageBudgetPort
} from '../../full-history-ledger-close-meta/FullHistoryBulkStorageBudget.js';
import { GoFullHistoryLedgerCloseMetaProcessor } from '../../full-history-ledger-close-meta/GoFullHistoryLedgerCloseMetaProcessor.js';
import { FullHistoryPublishedOutputInventory } from '../../full-history-ledger-close-meta/FullHistoryPublishedOutputInventory.js';
import type { FullHistoryLedgerCloseMetaServiceConfig } from './FullHistoryLedgerCloseMetaServiceConfig.js';

export interface FullHistoryLedgerCloseMetaComposition {
	readonly dataSource: DataSource;
	readonly frontier: AnonymousS3Sep54LedgerCloseMetaFrontier;
	readonly ingestion: IngestFullHistoryLedgerCloseMeta;
	readonly storageBudget: FullHistoryBulkStorageBudgetPort;
}

export const FULL_HISTORY_LEDGER_CLOSE_META_MAXIMUM_OUTPUT_BYTES_PER_SHARD =
	8 * 1_024 ** 3;
export const FULL_HISTORY_LEDGER_CLOSE_META_SERVICE_MEMORY_LIMIT_BYTES =
	96 * 1_024 ** 3;
const fullHistoryLedgerCloseMetaMaximumUncompressedBytes = 4 * 1_024 ** 3;
const fullHistoryLedgerCloseMetaMaximumDecodedMemoryBytes = 1 * 1_024 ** 3;
const fullHistoryLedgerCloseMetaPerWorkerOverheadBytes = 2 * 1_024 ** 3;
const fullHistoryLedgerCloseMetaServiceReserveBytes = 16 * 1_024 ** 3;

export function composeFullHistoryLedgerCloseMetaService(
	config: FullHistoryLedgerCloseMetaServiceConfig
): FullHistoryLedgerCloseMetaComposition {
	assertFullHistoryLedgerCloseMetaMemoryEnvelope(config.processingConcurrency);
	const dataSource = createDataSource();
	const repository = new TypeOrmFullHistoryLedgerCloseMetaManifestRepository(
		dataSource
	);
	const limiter = new AggregateIngressByteRateLimiter({
		bytesPerSecond: config.ingressBytesPerSecond,
		maximumBurstBytes: config.ingressBurstBytes
	});
	const source = new AnonymousHttpSep54LedgerCloseMetaSource({
		baseUrl: config.sourceBaseUrl,
		ingressLimiter: limiter,
		ledgersPath: config.sourceLedgersPath,
		maximumResponseBytes: 64 << 20,
		requestTimeoutMilliseconds: config.requestTimeoutMilliseconds
	});
	const outputInventory = new FullHistoryPublishedOutputInventory(
		config.typedOutputRoot
	);
	const processor = new GoFullHistoryLedgerCloseMetaProcessor({
		executablePath: config.executablePath,
		limits: {
			maximumCompressedBytes:
				FULL_HISTORY_LEDGER_CLOSE_META_SHARD_COMPRESSED_BYTES_LIMIT,
			maximumDecodedMemoryBytes:
				fullHistoryLedgerCloseMetaMaximumDecodedMemoryBytes,
			maximumLedgers: config.typedShardLedgerCount,
			maximumOutputBytes:
				FULL_HISTORY_LEDGER_CLOSE_META_MAXIMUM_OUTPUT_BYTES_PER_SHARD,
			maximumRows: 50_000_000,
			maximumUncompressedBytes:
				fullHistoryLedgerCloseMetaMaximumUncompressedBytes
		},
		maximumConcurrency: config.processingConcurrency,
		maximumQueueDepth: config.processingConcurrency * 2,
		minimumLedgers: FULL_HISTORY_LEDGER_CLOSE_META_TYPED_SHARD_LEDGER_MINIMUM,
		networkName: config.networkName,
		processTimeoutMilliseconds: config.processTimeoutMilliseconds,
		publicationRecorder: outputInventory,
		temporaryInputRoot: config.temporaryInputRoot,
		typedOutputRoot: config.typedOutputRoot
	});
	return Object.freeze({
		dataSource,
		frontier: new AnonymousS3Sep54LedgerCloseMetaFrontier({
			bucket: config.s3Bucket,
			ledgersPath: config.sourceLedgersPath,
			region: config.s3Region
		}),
		ingestion: new IngestFullHistoryLedgerCloseMeta({
			expectedNetworkPassphrase: config.networkPassphrase,
			fetchConcurrency: config.fetchConcurrency,
			firstAvailableLedger: config.firstAvailableLedger,
			manifestRepository: repository,
			maximumShardCompressedBytes:
				FULL_HISTORY_LEDGER_CLOSE_META_SHARD_COMPRESSED_BYTES_LIMIT,
			processingConcurrency: config.processingConcurrency,
			processor,
			retryDelaysMilliseconds: [250, 1_000, 5_000, 15_000],
			shouldRetrySourceFailure,
			source,
			typedShardLedgerCount: config.typedShardLedgerCount
		}),
		storageBudget: new FullHistoryBulkStorageBudget({
			maximumStoredBytes: config.maximumStoredBytes,
			minimumFreeBasisPoints: config.minimumFreeBasisPoints,
			minimumFreeBytes: config.minimumFreeBytes,
			rootPath: config.bulkRoot,
			usageReader: outputInventory
		})
	});
}

export function assertFullHistoryLedgerCloseMetaMemoryEnvelope(
	processingConcurrency: number
): void {
	if (!Number.isSafeInteger(processingConcurrency) || processingConcurrency < 1) {
		throw new RangeError('Processing concurrency must be a positive integer');
	}
	const perWorkerBytes =
		fullHistoryLedgerCloseMetaMaximumUncompressedBytes +
		fullHistoryLedgerCloseMetaMaximumDecodedMemoryBytes +
		2 * FULL_HISTORY_LEDGER_CLOSE_META_SHARD_COMPRESSED_BYTES_LIMIT +
		fullHistoryLedgerCloseMetaPerWorkerOverheadBytes;
	const maximumBytes =
		processingConcurrency * perWorkerBytes +
		fullHistoryLedgerCloseMetaServiceReserveBytes;
	if (maximumBytes > FULL_HISTORY_LEDGER_CLOSE_META_SERVICE_MEMORY_LIMIT_BYTES) {
		throw new RangeError(
			'Full-history LedgerCloseMeta processing concurrency exceeds its service memory envelope'
		);
	}
}

function createDataSource(): DataSource {
	const options = AppDataSource.options;
	if (options.type !== 'postgres') {
		throw new Error('Full-history LedgerCloseMeta ETL requires PostgreSQL');
	}
	return new DataSource({
		...options,
		entities: [],
		migrationsRun: false,
		poolSize: 4,
		synchronize: false
	});
}

function shouldRetrySourceFailure(error: unknown): boolean {
	return (
		error instanceof AnonymousHttpSep54SourceError &&
		(error.reason === 'network-failure' ||
			error.reason === 'request-timeout' ||
			(error.reason === 'http-status' &&
				(error.status === 429 || (error.status ?? 0) >= 500)))
	);
}
