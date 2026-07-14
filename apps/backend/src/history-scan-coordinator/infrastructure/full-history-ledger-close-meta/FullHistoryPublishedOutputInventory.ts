import { lstat, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import type { FullHistoryBulkStorageUsageReader } from './FullHistoryBulkStorageBudget.js';

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
	#initialization: Promise<void> | null = null;
	#storedBytes = 0n;

	constructor(rootPath: string) {
		this.#rootPath = safeRoot(rootPath);
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
		this.#storedBytes = (await readTreeBytes(this.#rootPath, false)) ?? 0n;
	}
}

async function readTreeBytes(
	rootPath: string,
	allowMissing: boolean
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
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) {
				directories.push(path);
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
			bytes += BigInt(value.size);
		}
	}
	return bytes;
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
