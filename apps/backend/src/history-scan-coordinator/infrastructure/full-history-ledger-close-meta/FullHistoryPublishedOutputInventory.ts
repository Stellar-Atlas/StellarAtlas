import { lstat, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import type { FullHistoryBulkStorageUsageReader } from './FullHistoryBulkStorageBudget.js';
import type { RegisteredOutputInventoryReader } from './TypeOrmRegisteredOutputInventory.js';

export interface FullHistoryPublishedOutputRecorder {
	recordPublication(
		outputPath: string,
		existedBeforeRun: boolean
	): Promise<void>;
}

export class FullHistoryPublishedOutputInventory
	implements
		FullHistoryBulkStorageUsageReader,
		FullHistoryPublishedOutputRecorder
{
	readonly #rootPath: string;
	readonly #registeredOutputInventoryReader: RegisteredOutputInventoryReader | undefined;
	#initialization: Promise<void> | null = null;
	#storedBytes = 0n;

	constructor(
		rootPath: string,
		registeredOutputInventoryReader?: RegisteredOutputInventoryReader
	) {
		this.#rootPath = safeRoot(rootPath);
		this.#registeredOutputInventoryReader = registeredOutputInventoryReader;
	}

	async readStoredBytes(): Promise<bigint> {
		await this.#initialize();
		return this.#storedBytes;
	}

	async recordPublication(
		outputPath: string,
		existedBeforeRun: boolean
	): Promise<void> {
		await this.#initialize();
		const path = strictChild(this.#rootPath, outputPath);
		if (existedBeforeRun) return;
		const bytes = await readTreeBytes(path, true);
		if (bytes !== null) this.#storedBytes += bytes;
	}

	#initialize(): Promise<void> {
		this.#initialization ??= this.#readInitialUsage();
		return this.#initialization;
	}

	async #readInitialUsage(): Promise<void> {
		const reader = this.#registeredOutputInventoryReader;
		if (reader === undefined) {
			this.#storedBytes = (await readTreeBytes(this.#rootPath, false, 4)) ?? 0n;
			return;
		}
		const snapshot = await reader.read();
		if (
			typeof snapshot.storedBytes !== 'bigint' ||
			snapshot.storedBytes < 0n ||
			!Number.isSafeInteger(snapshot.registeredCount) ||
			snapshot.registeredCount < 0 ||
			!isReadonlySet(snapshot.registeredDirectories) ||
			snapshot.registeredCount !== snapshot.registeredDirectories.size
		) {
			throw new Error('Invalid registered-output inventory snapshot');
		}
		const registeredPaths = new Set<string>();
		for (const path of snapshot.registeredDirectories) {
			if (!isRegisteredOutputDirectory(path)) {
				throw new Error('Invalid registered-output directory');
			}
			registeredPaths.add(strictChild(this.#rootPath, resolve(this.#rootPath, path)));
		}
		const filesystemBytes = await readTreeBytes(
			this.#rootPath,
			false,
			4,
			registeredPaths
		);
		this.#storedBytes = snapshot.storedBytes + (filesystemBytes ?? 0n);
	}
}

async function readTreeBytes(
	rootPath: string,
	allowMissing: boolean,
	maximumWorkers = 1,
	skipDirectories?: ReadonlySet<string>
): Promise<bigint | null> {
	let root;
	try {
		root = await lstat(rootPath);
	} catch (error) {
		if (allowMissing && isMissing(error)) return null;
		throw error;
	}
	if (!root.isDirectory() || root.isSymbolicLink()) {
		throw new Error('Full-history output inventory root must be a directory');
	}
	let bytes = 0n;
	const directories = [rootPath];
	while (directories.length > 0) {
		const directory = directories.pop()!;
		const entries = await readdir(directory, { withFileTypes: true });
		let nextIndex = 0;
		let hasError = false;
		let firstError: unknown;
		const workerSums = await Promise.all(
			Array.from(
				{ length: Math.min(maximumWorkers, entries.length) },
				async () => {
					let workerSum = 0n;
					while (!hasError) {
						const entryIndex = nextIndex;
						nextIndex += 1;
						if (entryIndex >= entries.length) return workerSum;
						const entry = entries[entryIndex];
						if (entry === undefined) return workerSum;
						const path = resolve(directory, entry.name);
						try {
							if (entry.isDirectory()) {
								if (!skipDirectories?.has(path)) directories.push(path);
								continue;
							}
							if (!entry.isFile()) {
								throw new Error(
									'Full-history output inventory contains a special file'
								);
							}
							const value = await lstat(path);
							if (!value.isFile() || value.isSymbolicLink()) {
								throw new Error(
									'Full-history output inventory contains a special file'
								);
							}
							workerSum += BigInt(value.size);
						} catch (error) {
							if (!hasError) {
								hasError = true;
								firstError = error;
							}
						}
					}
					return workerSum;
				}
			)
		);
		if (hasError) throw firstError;
		for (const workerSum of workerSums) bytes += workerSum;
	}
	return bytes;
}

function isReadonlySet(value: unknown): value is ReadonlySet<string> {
	return (
		typeof value === 'object' &&
		value !== null &&
		'size' in value &&
		Number.isSafeInteger(value.size) &&
		Symbol.iterator in value &&
		typeof value[Symbol.iterator] === 'function'
	);
}

function isRegisteredOutputDirectory(value: unknown): value is string {
	return typeof value === 'string' &&
		/^[a-f0-9]{64}\/ledger-close-meta\/[1-9][0-9]*-[1-9][0-9]*$/.test(value);
}

function safeRoot(value: string): string {
	const root = resolve(value);
	if (!value.startsWith('/') || root === resolve('/')) {
		throw new TypeError('Full-history output inventory requires a safe root');
	}
	return root;
}

function strictChild(root: string, candidate: string): string {
	const path = resolve(candidate);
	const child = relative(root, path);
	if (child.length === 0 || child === '..' || child.startsWith(`..${sep}`)) {
		throw new Error('Full-history publication path escapes its inventory root');
	}
	return path;
}

function isMissing(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		error.code === 'ENOENT'
	);
}
