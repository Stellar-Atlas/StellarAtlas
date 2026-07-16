import { createHash, randomUUID } from 'node:crypto';
import {
	fullHistoryLedgerCloseMetaRange,
	fullHistoryLedgerCloseMetaSha256Digest
} from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type { FullHistoryLedgerCloseMetaSourcePort } from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaPorts.js';
import {
	FULL_HISTORY_LEDGER_CLOSE_META_CANONICAL_MEDIA_TYPE,
	FULL_HISTORY_LEDGER_CLOSE_META_DATASETS,
	FULL_HISTORY_LEDGER_CLOSE_META_PARQUET_MEDIA_TYPE,
	FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS,
	FULL_HISTORY_LEDGER_CLOSE_META_SOURCE_DISPOSITION,
	type FullHistoryLedgerCloseMetaProcessorPort
} from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaProcessing.js';
import type {
	FullHistoryLedgerCloseMetaManifestRepository,
	FullHistoryLedgerCloseMetaProcessedBatchCommit,
	FullHistoryLedgerCloseMetaRegisteredSource,
	FullHistoryLedgerCloseMetaSourceRegistration
} from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaManifest.js';
import type {
	FullHistoryLedgerCloseMetaSourceDescriptor,
	FullHistoryLedgerCloseMetaSourceObject,
	FullHistoryLedgerCloseMetaSourceReadResult,
	Sep54LedgerCloseMetaConfig
} from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaSource.js';
import { StellarLedgerCloseMetaBatchDecoder } from '../../../infrastructure/full-history-ledger-close-meta/StellarLedgerCloseMetaBatchDecoder.js';
import { ledgerCloseMetaBatchFixture } from '../../../infrastructure/full-history-ledger-close-meta/__tests__/LedgerCloseMetaBatchTestFixture.js';
import {
	IngestFullHistoryLedgerCloseMeta,
	type FullHistoryLedgerCloseMetaIngestionTiming
} from '../IngestFullHistoryLedgerCloseMeta.js';

describe('IngestFullHistoryLedgerCloseMeta', () => {
	let source: FixtureSource;
	let manifest: FixtureManifestRepository;
	let processor: FixtureProcessor;
	let timing: FixtureTiming;

	beforeEach(() => {
		source = new FixtureSource();
		manifest = new FixtureManifestRepository();
		processor = new FixtureProcessor();
		timing = new FixtureTiming();
	});

	it('aggregates source objects into bounded typed shards', async () => {
		const ingestion = createIngestion();
		const signal = new AbortController().signal;
		const context = await ingestion.prepare(signal);
		const receipt = await ingestion.ingestRange(
			context,
			fullHistoryLedgerCloseMetaRange(3, 130),
			signal
		);

		expect(receipt).toEqual(
			expect.objectContaining({
				committedBatches: expect.any(Array),
				endLedger: 130,
				ledgerCount: 128,
				sourceObjectCount: 128,
				startLedger: 3
			})
		);
		expect(
			manifest.batches.map((batch) => batch.processing.range.startSequence)
		).toEqual([3, 67]);
		expect(source.requestedLedgers.sort((a, b) => a - b)).toEqual(
			Array.from({ length: 128 }, (_, index) => index + 3)
		);
		expect(source.maximumActiveReads).toBe(2);
		expect(processor.processedShardStarts.sort((a, b) => a - b)).toEqual([
			3, 67
		]);
		expect(manifest.maximumActiveCommits).toBe(1);
	});

	it('does not commit provenance when typed processing fails', async () => {
		processor.failureShardStart = 3;
		const ingestion = createIngestion();
		const signal = new AbortController().signal;
		const context = await ingestion.prepare(signal);

		await expect(
			ingestion.ingestRange(
				context,
				fullHistoryLedgerCloseMetaRange(3, 66),
				signal
			)
		).rejects.toThrow(/typed processing failed/);
		expect(manifest.batches).toEqual([]);
	});

	it('preserves a completed shard when another source object is missing', async () => {
		source.missingLedgers.add(67);
		const ingestion = createIngestion();
		const signal = new AbortController().signal;
		const context = await ingestion.prepare(signal);

		await expect(
			ingestion.ingestRange(
				context,
				fullHistoryLedgerCloseMetaRange(3, 130),
				signal
			)
		).rejects.toThrow(/missing ledger batch 67-67/);
		expect(
			manifest.batches.map((batch) => batch.processing.range.startSequence)
		).toEqual([3]);
	});

	it('retries only failures selected by the explicit source policy', async () => {
		source.configFailuresRemaining = 2;
		await createIngestion().prepare(new AbortController().signal);
		expect(source.configReadCount).toBe(3);
		expect(timing.waits).toEqual([10, 20]);
	});

	it('rejects concurrency and shard sizes above their ETL lane caps', () => {
		expect(() => createIngestion({ fetchConcurrency: 13 })).toThrow(
			/between 1 and 12/
		);
		expect(() => createIngestion({ processingConcurrency: 9 })).toThrow(
			/between 1 and 8/
		);
		expect(() => createIngestion({ typedShardLedgerCount: 1_025 })).toThrow(
			/between 64 and 1024/
		);
		expect(() => createIngestion({ typedShardLedgerCount: 63 })).toThrow(
			/between 64 and 1024/
		);
		expect(() => createIngestion({ maximumShardCompressedBytes: 0 })).toThrow(
			/maximumShardCompressedBytes/
		);
	});

	it('refuses to publish a partial typed shard', async () => {
		const ingestion = createIngestion();
		const signal = new AbortController().signal;
		const context = await ingestion.prepare(signal);

		await expect(
			ingestion.ingestRange(
				context,
				fullHistoryLedgerCloseMetaRange(3, 65),
				signal
			)
		).rejects.toThrow(/whole typed shards/i);
		expect(source.requestedLedgers).toEqual([]);
		expect(manifest.batches).toEqual([]);
	});

	it('rejects a transient shard that exceeds its aggregate byte budget', async () => {
		const ingestion = createIngestion({ maximumShardCompressedBytes: 1 });
		const signal = new AbortController().signal;
		const context = await ingestion.prepare(signal);

		await expect(
			ingestion.ingestRange(
				context,
				fullHistoryLedgerCloseMetaRange(3, 66),
				signal
			)
		).rejects.toThrow(/transient shard exceeds.*byte budget/i);
		expect(processor.processedShardStarts).toEqual([]);
		expect(manifest.batches).toEqual([]);
	});

	function createIngestion(
		overrides: {
			readonly fetchConcurrency?: number;
			readonly maximumShardCompressedBytes?: number;
			readonly processingConcurrency?: number;
			readonly typedShardLedgerCount?: number;
		} = {}
	): IngestFullHistoryLedgerCloseMeta {
		return new IngestFullHistoryLedgerCloseMeta({
			expectedNetworkPassphrase: NETWORK_PASSPHRASE,
			fetchConcurrency: overrides.fetchConcurrency ?? 2,
			firstAvailableLedger: 3,
			manifestRepository: manifest,
			maximumShardCompressedBytes:
				overrides.maximumShardCompressedBytes ?? 2_000_000,
			processingConcurrency: overrides.processingConcurrency ?? 2,
			processor,
			retryDelaysMilliseconds: [10, 20],
			shouldRetrySourceFailure: (error) => error instanceof RetryableError,
			source,
			timing,
			typedShardLedgerCount: overrides.typedShardLedgerCount ?? 64
		});
	}
});

class FixtureSource implements FullHistoryLedgerCloseMetaSourcePort {
	activeReads = 0;
	configFailuresRemaining = 0;
	configReadCount = 0;
	maximumActiveReads = 0;
	readonly missingLedgers = new Set<number>();
	readonly requestedLedgers: number[] = [];

	source(): FullHistoryLedgerCloseMetaSourceDescriptor {
		return {
			ledgersPath: 'v1.1/stellar/ledgers/pubnet',
			sourceUri: 'https://aws.example'
		};
	}

	async readConfig(): Promise<FullHistoryLedgerCloseMetaSourceObject> {
		this.configReadCount += 1;
		if (this.configFailuresRemaining > 0) {
			this.configFailuresRemaining -= 1;
			throw new RetryableError();
		}
		const bytes = Buffer.from(JSON.stringify(CONFIG), 'utf8');
		return sourceObject(bytes, 'v1.1/stellar/ledgers/pubnet/.config.json');
	}

	async readBatch(
		objectKey: string,
		signal: AbortSignal
	): Promise<FullHistoryLedgerCloseMetaSourceReadResult> {
		const sequence = sequenceFromObjectKey(objectKey);
		this.requestedLedgers.push(sequence);
		this.activeReads += 1;
		this.maximumActiveReads = Math.max(
			this.maximumActiveReads,
			this.activeReads
		);
		try {
			await abortableDelay(signal);
			if (this.missingLedgers.has(sequence)) return { status: 'not-found' };
			const fixture = ledgerCloseMetaBatchFixture(sequence, sequence, [
				sequence
			]);
			return {
				object: sourceObject(fixture.compressed, objectKey),
				status: 'found'
			};
		} finally {
			this.activeReads -= 1;
		}
	}
}

class FixtureManifestRepository implements FullHistoryLedgerCloseMetaManifestRepository {
	activeCommits = 0;
	readonly batches: FullHistoryLedgerCloseMetaProcessedBatchCommit[] = [];
	maximumActiveCommits = 0;
	registeredSource: FullHistoryLedgerCloseMetaRegisteredSource | null = null;

	async registerSource(
		registration: FullHistoryLedgerCloseMetaSourceRegistration
	): Promise<FullHistoryLedgerCloseMetaRegisteredSource> {
		this.registeredSource ??= {
			configDigest: registration.configDigest,
			firstAvailableLedger: registration.firstAvailableLedger,
			networkPassphraseHash: registration.networkPassphraseHash,
			nextLedger: registration.firstAvailableLedger,
			sourceId: randomUUID(),
			watermarkVersion: 0
		};
		return this.registeredSource;
	}

	async commitProcessedBatch(
		batch: FullHistoryLedgerCloseMetaProcessedBatchCommit
	) {
		this.activeCommits += 1;
		this.maximumActiveCommits = Math.max(
			this.maximumActiveCommits,
			this.activeCommits
		);
		try {
			await new Promise((resolve) => setTimeout(resolve, 2));
			this.batches.push(batch);
			return {
				batchId: randomUUID(),
				nextLedger: batch.processing.range.endSequence + 1,
				replayed: false,
				watermarkVersion: this.batches.length
			};
		} finally {
			this.activeCommits -= 1;
		}
	}

	readStoredBytes(): Promise<bigint> {
		return Promise.resolve(0n);
	}
}

class FixtureProcessor implements FullHistoryLedgerCloseMetaProcessorPort {
	readonly #decoder = new StellarLedgerCloseMetaBatchDecoder({
		maximumCompressedBytes: 1_000_000,
		maximumUncompressedBytes: 2_000_000
	});
	failureShardStart: number | null = null;
	readonly processedShardStarts: number[] = [];

	processAndCommit(
		request: Parameters<
			FullHistoryLedgerCloseMetaProcessorPort['processAndCommit']
		>[0]
	) {
		const decoded = request.inputs.map((input) => ({
			batch: this.#decoder.decode({
				compressedPayload: input.object.bytes,
				expectedRange: input.expectedRange
			}),
			identity: input.object.identity
		}));
		const first = decoded[0]!;
		const last = decoded.at(-1)!;
		const range = fullHistoryLedgerCloseMetaRange(
			first.batch.range.startSequence,
			last.batch.range.endSequence
		);
		if (range.startSequence === this.failureShardStart) {
			return Promise.reject(new Error('typed processing failed'));
		}
		this.processedShardStarts.push(range.startSequence);
		const manifestSha256 = fullHistoryLedgerCloseMetaSha256Digest(
			createHash('sha256')
				.update(decoded.map((value) => value.batch.xdrSha256).join(':'))
				.digest('hex')
		);
		return Promise.resolve({
			manifestSha256,
			outputs: FULL_HISTORY_LEDGER_CLOSE_META_DATASETS.map((dataset) => ({
				byteCount: 100,
				dataset,
				mediaType:
					dataset === 'ledger-close-meta'
						? FULL_HISTORY_LEDGER_CLOSE_META_CANONICAL_MEDIA_TYPE
						: FULL_HISTORY_LEDGER_CLOSE_META_PARQUET_MEDIA_TYPE,
				representation:
					dataset === 'ledger-close-meta'
						? 'lossless-replay'
						: 'typed-projection',
				recordCount:
					dataset === 'ledger-close-meta' || dataset === 'ledgers'
						? range.ledgerCount
						: 0,
				schemaVersion: FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS[dataset],
				sha256: manifestSha256,
				storageKey: `${dataset}/${range.startSequence}-${range.endSequence}`
			})),
			range,
			sourceDisposition: FULL_HISTORY_LEDGER_CLOSE_META_SOURCE_DISPOSITION,
			sourceObjects: decoded.map(({ batch, identity }) => ({
				...batch,
				...(identity.etag === undefined ? {} : { etag: identity.etag }),
				firstPreviousLedgerHash: ledgerHash(batch.range.startSequence - 1),
				generation: identity.generation,
				lastLedgerHash: ledgerHash(batch.range.endSequence),
				objectKey: identity.objectKey
			}))
		});
	}
}

function ledgerHash(sequence: number) {
	return fullHistoryLedgerCloseMetaSha256Digest(
		createHash('sha256').update(`fixture-ledger:${sequence}`).digest('hex')
	);
}

class FixtureTiming implements FullHistoryLedgerCloseMetaIngestionTiming {
	readonly waits: number[] = [];

	now(): Date {
		return new Date('2026-07-14T00:00:00.000Z');
	}

	wait(milliseconds: number, signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		this.waits.push(milliseconds);
		return Promise.resolve();
	}
}

class RetryableError extends Error {}

const NETWORK_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
const CONFIG: Sep54LedgerCloseMetaConfig = Object.freeze({
	batchesPerPartition: 64_000,
	compression: 'zstd',
	ledgersPerBatch: 1,
	networkPassphrase: NETWORK_PASSPHRASE,
	version: '1.0'
});

function sourceObject(
	bytes: Uint8Array,
	objectKey: string
): FullHistoryLedgerCloseMetaSourceObject {
	return {
		bytes,
		identity: {
			generation: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
			objectKey,
			sourceUri: `https://aws.example/${objectKey}`
		}
	};
}

function sequenceFromObjectKey(objectKey: string): number {
	const match = /--([0-9]+)\.xdr\.zst$/.exec(objectKey);
	if (match === null) throw new Error(`Unexpected object key ${objectKey}`);
	return Number(match[1]);
}

function abortableDelay(signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(finish, 2);
		const onAbort = (): void => {
			clearTimeout(timeout);
			signal.removeEventListener('abort', onAbort);
			reject(signal.reason);
		};
		function finish(): void {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}
		signal.addEventListener('abort', onAbort, { once: true });
	});
}
