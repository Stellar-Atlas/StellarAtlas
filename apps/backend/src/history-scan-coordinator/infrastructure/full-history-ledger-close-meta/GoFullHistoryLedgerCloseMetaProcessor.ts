import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type {
	FullHistoryLedgerCloseMetaProcessingReceipt,
	FullHistoryLedgerCloseMetaProcessingRequest,
	FullHistoryLedgerCloseMetaProcessorPort
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaProcessing.js';
import { BoundedAsyncTaskPool } from './BoundedAsyncTaskPool.js';
import type { FullHistoryPublishedOutputRecorder } from './FullHistoryPublishedOutputInventory.js';
import { runBoundedGoFullHistoryProcess } from './GoFullHistoryLedgerCloseMetaProcessRunner.js';
import { verifyGoFullHistoryLedgerCloseMetaPublication } from './GoFullHistoryLedgerCloseMetaPublicationVerifier.js';
import { parseGoFullHistoryLedgerCloseMetaReceipt } from './GoFullHistoryLedgerCloseMetaReceipt.js';

const maximumProcessConcurrency = 12;
const maximumInputCount = 1_024;
const sharedMemoryRoot = '/dev/shm';

export interface GoFullHistoryLedgerCloseMetaProcessorOptions {
	readonly executablePath: string;
	readonly limits: GoFullHistoryLedgerCloseMetaProcessorLimits;
	readonly maximumConcurrency: number;
	readonly maximumQueueDepth: number;
	readonly minimumLedgers: number;
	readonly networkName: string;
	readonly publicationRecorder?: FullHistoryPublishedOutputRecorder;
	readonly processTimeoutMilliseconds: number;
	readonly temporaryInputRoot: string;
	readonly typedOutputRoot: string;
}

export interface GoFullHistoryLedgerCloseMetaProcessorLimits {
	readonly maximumCompressedBytes: number;
	readonly maximumDecodedMemoryBytes: number;
	readonly maximumLedgers: number;
	readonly maximumOutputBytes: number;
	readonly maximumRows: number;
	readonly maximumUncompressedBytes: number;
}

export class GoFullHistoryLedgerCloseMetaProcessor implements FullHistoryLedgerCloseMetaProcessorPort {
	readonly #executablePath: string;
	readonly #limits: GoFullHistoryLedgerCloseMetaProcessorLimits;
	readonly #minimumLedgers: number;
	readonly #networkName: string;
	readonly #pool: BoundedAsyncTaskPool;
	readonly #publicationRecorder: FullHistoryPublishedOutputRecorder | null;
	readonly #processTimeoutMilliseconds: number;
	readonly #temporaryInputRoot: string;
	readonly #typedOutputRoot: string;

	constructor(options: GoFullHistoryLedgerCloseMetaProcessorOptions) {
		assertOptions(options);
		this.#executablePath = resolve(options.executablePath);
		this.#limits = Object.freeze({ ...options.limits });
		this.#minimumLedgers = options.minimumLedgers;
		this.#networkName = options.networkName;
		this.#pool = new BoundedAsyncTaskPool(
			options.maximumConcurrency,
			options.maximumQueueDepth
		);
		this.#publicationRecorder = options.publicationRecorder ?? null;
		this.#processTimeoutMilliseconds = options.processTimeoutMilliseconds;
		this.#temporaryInputRoot = resolve(options.temporaryInputRoot);
		this.#typedOutputRoot = resolve(options.typedOutputRoot);
	}

	processAndCommit(
		request: FullHistoryLedgerCloseMetaProcessingRequest,
		signal: AbortSignal
	): Promise<FullHistoryLedgerCloseMetaProcessingReceipt> {
		return this.#pool.run(signal, () => this.#process(request, signal));
	}

	async #process(
		request: FullHistoryLedgerCloseMetaProcessingRequest,
		signal: AbortSignal
	): Promise<FullHistoryLedgerCloseMetaProcessingReceipt> {
		const range = requestRange(request, this.#minimumLedgers);
		signal.throwIfAborted();
		await mkdir(this.#temporaryInputRoot, { mode: 0o700, recursive: true });
		const temporaryDirectory = await mkdtemp(
			join(this.#temporaryInputRoot, 'ledger-close-meta-')
		);
		const outputPath = this.#outputPath(request, range);
		const outputExistedBeforeRun = await directoryExists(outputPath);
		try {
			const inputPaths = await writeTransientInputs(
				temporaryDirectory,
				request
			);
			const stdout = await runBoundedGoFullHistoryProcess(
				this.#executablePath,
				this.#arguments(request, inputPaths, outputPath, range),
				this.#processTimeoutMilliseconds,
				signal
			);
			const receipt = parseGoFullHistoryLedgerCloseMetaReceipt(
				parseJson(stdout)
			);
			return await verifyGoFullHistoryLedgerCloseMetaPublication({
				networkName: this.#networkName,
				outputPath,
				receipt,
				request,
				typedOutputRoot: this.#typedOutputRoot
			});
		} finally {
			try {
				await this.#publicationRecorder?.recordPublication(
					outputPath,
					outputExistedBeforeRun
				);
			} finally {
				await rm(temporaryDirectory, { force: true, recursive: true });
			}
		}
	}

	#outputPath(
		request: FullHistoryLedgerCloseMetaProcessingRequest,
		range: ProcessingRange
	): string {
		const networkId = sha256(Buffer.from(request.networkPassphrase, 'utf8'));
		return join(
			this.#typedOutputRoot,
			networkId,
			'ledger-close-meta',
			`${range.startLedger}-${range.endLedger}`
		);
	}

	#arguments(
		request: FullHistoryLedgerCloseMetaProcessingRequest,
		inputPaths: readonly string[],
		outputPath: string,
		range: ProcessingRange
	): readonly string[] {
		const sourceArguments = request.inputs.flatMap((input, index) => [
			'--input',
			inputPaths[index]!,
			'--input-object-key',
			input.object.identity.objectKey
		]);
		const limits = this.#limits;
		return [
			...sourceArguments,
			'--typed-output-root',
			this.#typedOutputRoot,
			'--output',
			outputPath,
			'--network',
			this.#networkName,
			'--network-passphrase',
			request.networkPassphrase,
			'--start-ledger',
			String(range.startLedger),
			'--end-ledger',
			String(range.endLedger),
			'--max-compressed-bytes',
			String(limits.maximumCompressedBytes),
			'--max-uncompressed-bytes',
			String(limits.maximumUncompressedBytes),
			'--max-decoded-memory-bytes',
			String(limits.maximumDecodedMemoryBytes),
			'--max-output-bytes',
			String(limits.maximumOutputBytes),
			'--max-ledgers',
			String(limits.maximumLedgers),
			'--max-rows',
			String(limits.maximumRows)
		];
	}
}

interface ProcessingRange {
	readonly endLedger: number;
	readonly startLedger: number;
}

function requestRange(
	request: FullHistoryLedgerCloseMetaProcessingRequest,
	minimumLedgers: number
): ProcessingRange {
	if (
		request.inputs.length === 0 ||
		request.inputs.length > maximumInputCount
	) {
		throw new RangeError(
			`Full-history ETL input count must be between 1 and ${maximumInputCount}`
		);
	}
	let nextLedger: number = request.inputs[0]!.expectedRange.startSequence;
	for (const input of request.inputs) {
		if (input.expectedRange.startSequence !== nextLedger) {
			throw new RangeError(
				'Full-history ETL inputs must be ordered and contiguous'
			);
		}
		nextLedger = input.expectedRange.endSequence + 1;
	}
	const range = {
		endLedger: request.inputs.at(-1)!.expectedRange.endSequence,
		startLedger: request.inputs[0]!.expectedRange.startSequence
	};
	if (range.endLedger - range.startLedger + 1 < minimumLedgers) {
		throw new RangeError(
			`Full-history ETL shard must contain at least ${minimumLedgers} ledgers`
		);
	}
	return range;
}

async function writeTransientInputs(
	temporaryDirectory: string,
	request: FullHistoryLedgerCloseMetaProcessingRequest
): Promise<readonly string[]> {
	const paths: string[] = [];
	for (const [index, input] of request.inputs.entries()) {
		const path = join(
			temporaryDirectory,
			`${String(index).padStart(4, '0')}.xdr.zstd`
		);
		await writeFile(path, input.object.bytes, { flag: 'wx', mode: 0o600 });
		paths.push(path);
	}
	return Object.freeze(paths);
}

function parseJson(bytes: Uint8Array): unknown {
	try {
		return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
	} catch (error) {
		throw new Error('Full-history ETL receipt is not valid JSON', {
			cause: error
		});
	}
}

function sha256(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

function assertOptions(
	options: GoFullHistoryLedgerCloseMetaProcessorOptions
): void {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.networkName)) {
		throw new TypeError('networkName is invalid');
	}
	if (
		!Number.isSafeInteger(options.minimumLedgers) ||
		options.minimumLedgers < 1 ||
		options.minimumLedgers > options.limits.maximumLedgers
	) {
		throw new RangeError(
			'minimumLedgers must be bounded by the processor ledger limit'
		);
	}
	if (
		!Number.isSafeInteger(options.maximumConcurrency) ||
		options.maximumConcurrency < 1 ||
		options.maximumConcurrency > maximumProcessConcurrency
	) {
		throw new RangeError('maximumConcurrency must be between 1 and 12');
	}
	if (
		!Number.isSafeInteger(options.processTimeoutMilliseconds) ||
		options.processTimeoutMilliseconds < 1_000 ||
		options.processTimeoutMilliseconds > 3_600_000
	) {
		throw new RangeError('processTimeoutMilliseconds must be bounded');
	}
	for (const [field, value] of Object.entries(options.limits)) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new RangeError(`${field} must be a positive safe integer`);
		}
	}
	const temporary = resolve(options.temporaryInputRoot);
	const typed = resolve(options.typedOutputRoot);
	if (
		!isChild(sharedMemoryRoot, temporary) ||
		temporary === typed ||
		temporary === dirname(temporary) ||
		typed === dirname(typed) ||
		isChild(temporary, typed) ||
		isChild(typed, temporary)
	) {
		throw new Error('Transient input and typed output roots must be distinct');
	}
}

function isChild(parent: string, candidate: string): boolean {
	const child = relative(parent, candidate);
	return child.length > 0 && child !== '..' && !child.startsWith(`..${sep}`);
}

async function directoryExists(path: string): Promise<boolean> {
	try {
		const value = await lstat(path);
		if (!value.isDirectory() || value.isSymbolicLink()) {
			throw new Error('Full-history output path is not a regular directory');
		}
		return true;
	} catch (error) {
		if (
			typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			error.code === 'ENOENT'
		) {
			return false;
		}
		throw error;
	}
}
