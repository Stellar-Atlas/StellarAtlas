import { createHash } from 'node:crypto';
import {
	fullHistoryLedgerCloseMetaRange,
	fullHistoryLedgerCloseMetaSequence,
	fullHistoryLedgerCloseMetaSha256Digest,
	type FullHistoryLedgerCloseMetaRange,
	type FullHistoryLedgerCloseMetaSequence
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type { FullHistoryLedgerCloseMetaSourcePort } from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaPorts.js';
import {
	assertFullHistoryLedgerCloseMetaProcessingReceipt,
	type FullHistoryLedgerCloseMetaProcessingReceipt,
	type FullHistoryLedgerCloseMetaProcessorPort
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaProcessing.js';
import type {
	FullHistoryLedgerCloseMetaBatchCommitReceipt,
	FullHistoryLedgerCloseMetaManifestRepository,
	FullHistoryLedgerCloseMetaRegisteredSource
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaManifest.js';
import type {
	FullHistoryLedgerCloseMetaSourceObject,
	Sep54LedgerCloseMetaConfig
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaSource.js';
import { BoundedAsyncTaskPool } from '../../infrastructure/full-history-ledger-close-meta/BoundedAsyncTaskPool.js';
import {
	createSep54LedgerCloseMetaObjectKey,
	parseSep54LedgerCloseMetaConfig
} from '../../infrastructure/full-history-ledger-close-meta/Sep54LedgerCloseMetaObjectKey.js';

export const FULL_HISTORY_LEDGER_CLOSE_META_FETCH_CONCURRENCY_MAX = 12;
export const FULL_HISTORY_LEDGER_CLOSE_META_PROCESSING_CONCURRENCY_MAX = 8;
export const FULL_HISTORY_LEDGER_CLOSE_META_RANGE_LEDGER_LIMIT = 65_536;
export const FULL_HISTORY_LEDGER_CLOSE_META_SHARD_COMPRESSED_BYTES_LIMIT =
	1 * 1_024 ** 3;
export const FULL_HISTORY_LEDGER_CLOSE_META_TYPED_SHARD_LEDGER_MINIMUM = 64;
export const FULL_HISTORY_LEDGER_CLOSE_META_TYPED_SHARD_LEDGER_LIMIT = 1_024;

export interface FullHistoryLedgerCloseMetaIngestionTiming {
	now(): Date;
	wait(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export interface IngestFullHistoryLedgerCloseMetaOptions {
	readonly expectedNetworkPassphrase: string;
	readonly fetchConcurrency: number;
	readonly firstAvailableLedger: number;
	readonly manifestRepository: FullHistoryLedgerCloseMetaManifestRepository;
	readonly maximumShardCompressedBytes: number;
	readonly processingConcurrency: number;
	readonly processor: FullHistoryLedgerCloseMetaProcessorPort;
	readonly retryDelaysMilliseconds: readonly number[];
	readonly shouldRetrySourceFailure: (error: unknown) => boolean;
	readonly source: FullHistoryLedgerCloseMetaSourcePort;
	readonly timing?: FullHistoryLedgerCloseMetaIngestionTiming;
	readonly typedShardLedgerCount: number;
}

export interface FullHistoryLedgerCloseMetaIngestionContext {
	readonly config: Sep54LedgerCloseMetaConfig;
	readonly registeredSource: FullHistoryLedgerCloseMetaRegisteredSource;
}

export interface FullHistoryLedgerCloseMetaPreparedInput {
	readonly object: FullHistoryLedgerCloseMetaSourceObject;
	readonly range: FullHistoryLedgerCloseMetaRange;
}

export interface FullHistoryLedgerCloseMetaIngestionReceipt {
	readonly committedBatches: readonly FullHistoryLedgerCloseMetaBatchCommitReceipt[];
	readonly endLedger: number;
	readonly ledgerCount: number;
	readonly sourceObjectCount: number;
	readonly startLedger: number;
}

export class IngestFullHistoryLedgerCloseMeta {
	readonly #expectedNetworkPassphrase: string;
	readonly #fetchPool: BoundedAsyncTaskPool;
	readonly #fetchWindowSize: number;
	readonly #firstAvailableLedger: FullHistoryLedgerCloseMetaSequence;
	readonly #manifestRepository: FullHistoryLedgerCloseMetaManifestRepository;
	readonly #maximumShardCompressedBytes: number;
	readonly #processingConcurrency: number;
	readonly #processor: FullHistoryLedgerCloseMetaProcessorPort;
	readonly #retryDelaysMilliseconds: readonly number[];
	readonly #shouldRetrySourceFailure: (error: unknown) => boolean;
	readonly #source: FullHistoryLedgerCloseMetaSourcePort;
	readonly #timing: FullHistoryLedgerCloseMetaIngestionTiming;
	readonly #typedShardLedgerCount: number;

	constructor(options: IngestFullHistoryLedgerCloseMetaOptions) {
		assertConcurrency(
			options.fetchConcurrency,
			'fetchConcurrency',
			FULL_HISTORY_LEDGER_CLOSE_META_FETCH_CONCURRENCY_MAX
		);
		assertConcurrency(
			options.processingConcurrency,
			'processingConcurrency',
			FULL_HISTORY_LEDGER_CLOSE_META_PROCESSING_CONCURRENCY_MAX
		);
		assertTypedShardLedgerCount(options.typedShardLedgerCount);
		assertShardCompressedBytes(options.maximumShardCompressedBytes);
		this.#firstAvailableLedger = fullHistoryLedgerCloseMetaSequence(
			options.firstAvailableLedger,
			'firstAvailableLedger'
		);
		if (options.expectedNetworkPassphrase.trim().length === 0) {
			throw new TypeError('expectedNetworkPassphrase cannot be empty');
		}
		assertRetryDelays(options.retryDelaysMilliseconds);
		this.#expectedNetworkPassphrase = options.expectedNetworkPassphrase;
		this.#fetchPool = new BoundedAsyncTaskPool(
			options.fetchConcurrency,
			options.fetchConcurrency * options.processingConcurrency
		);
		this.#fetchWindowSize = options.fetchConcurrency;
		this.#manifestRepository = options.manifestRepository;
		this.#maximumShardCompressedBytes = options.maximumShardCompressedBytes;
		this.#processingConcurrency = options.processingConcurrency;
		this.#processor = options.processor;
		this.#retryDelaysMilliseconds = Object.freeze([
			...options.retryDelaysMilliseconds
		]);
		this.#shouldRetrySourceFailure = options.shouldRetrySourceFailure;
		this.#source = options.source;
		this.#timing = options.timing ?? systemTiming;
		this.#typedShardLedgerCount = options.typedShardLedgerCount;
	}

	async prepare(
		signal: AbortSignal
	): Promise<FullHistoryLedgerCloseMetaIngestionContext> {
		const configObject = await this.#readConfigWithRetry(signal);
		const config = parseSep54LedgerCloseMetaConfig(configObject.bytes);
		if (config.networkPassphrase !== this.#expectedNetworkPassphrase) {
			throw new Error('SEP-54 source network passphrase does not match');
		}
		if (this.#typedShardLedgerCount % config.ledgersPerBatch !== 0) {
			throw new RangeError(
				'typedShardLedgerCount must contain whole SEP-54 source batches'
			);
		}
		const registration = await this.#manifestRepository.registerSource({
			config,
			configDigest: sha256(configObject.bytes),
			configObject,
			firstAvailableLedger: this.#firstAvailableLedger,
			networkPassphraseHash: sha256(
				Buffer.from(config.networkPassphrase, 'utf8')
			),
			observedAt: this.#timing.now(),
			source: this.#source.source()
		});
		return Object.freeze({
			config,
			registeredSource: registration
		});
	}

	async ingestRange(
		context: FullHistoryLedgerCloseMetaIngestionContext,
		rangeInput: FullHistoryLedgerCloseMetaRange,
		signal: AbortSignal
	): Promise<FullHistoryLedgerCloseMetaIngestionReceipt> {
		const range = validateIngestionRange(
			context.config,
			rangeInput,
			context.registeredSource.firstAvailableLedger
		);
		if (range.ledgerCount % this.#typedShardLedgerCount !== 0) {
			throw new RangeError(
				'LedgerCloseMeta ingestion range must contain whole typed shards'
			);
		}
		const shardRanges = createShardRanges(
			range,
			context.config.ledgersPerBatch,
			this.#typedShardLedgerCount
		);
		const commits: FullHistoryLedgerCloseMetaBatchCommitReceipt[] = [];
		let sourceObjectCount = 0;
		for (
			let offset = 0;
			offset < shardRanges.length;
			offset += this.#processingConcurrency
		) {
			signal.throwIfAborted();
			const group = shardRanges.slice(
				offset,
				offset + this.#processingConcurrency
			);
			const outcomes = await Promise.allSettled(
				group.map((shard) => this.#processShard(context, shard, signal))
			);
			for (const outcome of outcomes) {
				if (outcome.status === 'fulfilled') {
					const commit = await this.#manifestRepository.commitProcessedBatch({
						processedAt: this.#timing.now(),
						processing: outcome.value.processing,
						source: context.registeredSource
					});
					commits.push(commit);
					sourceObjectCount += outcome.value.sourceObjectCount;
				}
			}
			const failure = outcomes.find(
				(outcome): outcome is PromiseRejectedResult =>
					outcome.status === 'rejected'
			);
			if (failure !== undefined) throw failure.reason;
		}
		return Object.freeze({
			committedBatches: Object.freeze(commits),
			endLedger: range.endSequence,
			ledgerCount: range.ledgerCount,
			sourceObjectCount,
			startLedger: range.startSequence
		});
	}

	async #processShard(
		context: FullHistoryLedgerCloseMetaIngestionContext,
		range: FullHistoryLedgerCloseMetaRange,
		signal: AbortSignal
	): Promise<{
		readonly processing: FullHistoryLedgerCloseMetaProcessingReceipt;
		readonly sourceObjectCount: number;
	}> {
		const inputs = await this.#readShardInputs(context, range, signal);
		const processing = await this.#processor.processAndCommit(
			{
				inputs: inputs.map((input) => ({
					expectedRange: input.range,
					object: input.object
				})),
				networkPassphrase: context.config.networkPassphrase,
				source: {
					configDigest: context.registeredSource.configDigest,
					sourceId: context.registeredSource.sourceId
				}
			},
			signal
		);
		assertFullHistoryLedgerCloseMetaProcessingReceipt(processing);
		assertProcessingMatchesInputs(range, inputs, processing);
		return { processing, sourceObjectCount: inputs.length };
	}

	async #readShardInputs(
		context: FullHistoryLedgerCloseMetaIngestionContext,
		shardRange: FullHistoryLedgerCloseMetaRange,
		signal: AbortSignal
	): Promise<readonly FullHistoryLedgerCloseMetaPreparedInput[]> {
		const ranges = createSourceRanges(context.config, shardRange);
		const inputs: FullHistoryLedgerCloseMetaPreparedInput[] = [];
		let compressedBytes = 0;
		for (
			let offset = 0;
			offset < ranges.length;
			offset += this.#fetchWindowSize
		) {
			const window = ranges.slice(offset, offset + this.#fetchWindowSize);
			const fetched = await Promise.all(
				window.map((range) =>
					this.#fetchPool.run(signal, () =>
						this.#preparedInput(context, range, signal)
					)
				)
			);
			for (const input of fetched) {
				compressedBytes += input.object.bytes.byteLength;
				if (compressedBytes > this.#maximumShardCompressedBytes) {
					throw new RangeError(
						'Full-history ETL transient shard exceeds its compressed byte budget'
					);
				}
				inputs.push(input);
			}
		}
		return Object.freeze(inputs);
	}

	#preparedInput(
		context: FullHistoryLedgerCloseMetaIngestionContext,
		range: FullHistoryLedgerCloseMetaRange,
		signal: AbortSignal
	): Promise<FullHistoryLedgerCloseMetaPreparedInput> {
		return this.#readInput(context.config, range, signal);
	}

	#readConfigWithRetry(
		signal: AbortSignal
	): Promise<FullHistoryLedgerCloseMetaSourceObject> {
		return this.#retry(() => this.#source.readConfig(signal), signal);
	}

	async #readInput(
		config: Sep54LedgerCloseMetaConfig,
		range: FullHistoryLedgerCloseMetaRange,
		signal: AbortSignal
	): Promise<FullHistoryLedgerCloseMetaPreparedInput> {
		const location = createSep54LedgerCloseMetaObjectKey(
			config,
			range,
			this.#source.source().ledgersPath
		);
		const result = await this.#retry(
			() => this.#source.readBatch(location.objectKey, signal),
			signal
		);
		if (result.status === 'not-found') {
			throw new Error(
				`SEP-54 source is missing ledger batch ${range.startSequence}-${range.endSequence}`
			);
		}
		return Object.freeze({ object: result.object, range });
	}

	async #retry<T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> {
		let attempt = 0;
		while (true) {
			try {
				return await action();
			} catch (error) {
				signal.throwIfAborted();
				const delay = this.#retryDelaysMilliseconds[attempt];
				if (delay === undefined || !this.#shouldRetrySourceFailure(error)) {
					throw error;
				}
				attempt += 1;
				await this.#timing.wait(delay, signal);
			}
		}
	}
}

function assertProcessingMatchesInputs(
	range: FullHistoryLedgerCloseMetaRange,
	inputs: readonly FullHistoryLedgerCloseMetaPreparedInput[],
	processing: FullHistoryLedgerCloseMetaProcessingReceipt
): void {
	if (
		processing.range.startSequence !== range.startSequence ||
		processing.range.endSequence !== range.endSequence ||
		processing.sourceObjects.length !== inputs.length
	) {
		throw new Error('LedgerCloseMeta processor returned another shard range');
	}
	for (const [index, input] of inputs.entries()) {
		const evidence = processing.sourceObjects[index];
		if (
			evidence === undefined ||
			evidence.objectKey !== input.object.identity.objectKey ||
			evidence.range.startSequence !== input.range.startSequence ||
			evidence.range.endSequence !== input.range.endSequence ||
			evidence.compressedByteCount !== input.object.bytes.byteLength ||
			evidence.compressedSha256 !== sha256(input.object.bytes)
		) {
			throw new Error(
				'LedgerCloseMeta processor evidence does not match its transient inputs'
			);
		}
	}
}

function validateIngestionRange(
	config: Sep54LedgerCloseMetaConfig,
	rangeInput: FullHistoryLedgerCloseMetaRange,
	firstAvailableLedger: number
): FullHistoryLedgerCloseMetaRange {
	const range = fullHistoryLedgerCloseMetaRange(
		rangeInput.startSequence,
		rangeInput.endSequence
	);
	if (
		range.ledgerCount > FULL_HISTORY_LEDGER_CLOSE_META_RANGE_LEDGER_LIMIT ||
		range.ledgerCount % config.ledgersPerBatch !== 0 ||
		(range.startSequence - firstAvailableLedger) % config.ledgersPerBatch !== 0
	) {
		throw new RangeError(
			'LedgerCloseMeta ingestion range must contain aligned whole source batches'
		);
	}
	return range;
}

function createShardRanges(
	range: FullHistoryLedgerCloseMetaRange,
	ledgersPerBatch: number,
	typedShardLedgerCount: number
): readonly FullHistoryLedgerCloseMetaRange[] {
	const ranges: FullHistoryLedgerCloseMetaRange[] = [];
	for (
		let start: number = range.startSequence;
		start <= range.endSequence;
		start += typedShardLedgerCount
	) {
		if (typedShardLedgerCount % ledgersPerBatch !== 0) {
			throw new RangeError('Typed shard would split a SEP-54 source batch');
		}
		ranges.push(
			fullHistoryLedgerCloseMetaRange(start, start + typedShardLedgerCount - 1)
		);
	}
	return ranges;
}

function createSourceRanges(
	config: Sep54LedgerCloseMetaConfig,
	range: FullHistoryLedgerCloseMetaRange
): readonly FullHistoryLedgerCloseMetaRange[] {
	const ranges: FullHistoryLedgerCloseMetaRange[] = [];
	for (
		let start: number = range.startSequence;
		start <= range.endSequence;
		start += config.ledgersPerBatch
	) {
		ranges.push(
			fullHistoryLedgerCloseMetaRange(start, start + config.ledgersPerBatch - 1)
		);
	}
	return ranges;
}

function sha256(value: Uint8Array) {
	return fullHistoryLedgerCloseMetaSha256Digest(
		createHash('sha256').update(value).digest('hex')
	);
}

function assertConcurrency(
	value: number,
	field: string,
	maximum: number
): void {
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
		throw new RangeError(`${field} must be between 1 and ${maximum}`);
	}
}

function assertTypedShardLedgerCount(value: number): void {
	if (
		!Number.isSafeInteger(value) ||
		value < FULL_HISTORY_LEDGER_CLOSE_META_TYPED_SHARD_LEDGER_MINIMUM ||
		value > FULL_HISTORY_LEDGER_CLOSE_META_TYPED_SHARD_LEDGER_LIMIT
	) {
		throw new RangeError(
			`typedShardLedgerCount must be between ${FULL_HISTORY_LEDGER_CLOSE_META_TYPED_SHARD_LEDGER_MINIMUM} and ${FULL_HISTORY_LEDGER_CLOSE_META_TYPED_SHARD_LEDGER_LIMIT}`
		);
	}
}

function assertShardCompressedBytes(value: number): void {
	if (
		!Number.isSafeInteger(value) ||
		value < 1 ||
		value > FULL_HISTORY_LEDGER_CLOSE_META_SHARD_COMPRESSED_BYTES_LIMIT
	) {
		throw new RangeError(
			`maximumShardCompressedBytes must be between 1 and ${FULL_HISTORY_LEDGER_CLOSE_META_SHARD_COMPRESSED_BYTES_LIMIT}`
		);
	}
}

function assertRetryDelays(values: readonly number[]): void {
	if (
		values.length > 8 ||
		values.some(
			(value) => !Number.isSafeInteger(value) || value < 0 || value > 60_000
		)
	) {
		throw new RangeError('Source retry delays must be bounded milliseconds');
	}
}

const systemTiming: FullHistoryLedgerCloseMetaIngestionTiming = {
	now: () => new Date(),
	wait: (milliseconds, signal) =>
		new Promise((resolve, reject) => {
			const timeout = setTimeout(finish, milliseconds);
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
			if (signal.aborted) onAbort();
		})
};
