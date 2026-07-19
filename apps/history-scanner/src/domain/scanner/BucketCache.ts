import { createReadStream, createWriteStream } from 'node:fs';
import type { Dirent } from 'node:fs';
import {
	mkdir,
	readdir,
	rename,
	rm,
	stat,
	utimes,
	writeFile
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { err, ok, Result } from 'neverthrow';
import type { Logger } from 'logger';
import { mapUnknownToError } from 'shared';

interface CacheEntry {
	path: string;
	size: number;
	mtimeMs: number;
}

export class BucketCacheFailure extends Error {
	readonly failureChannel: 'archive_evidence' | 'scanner_issue';

	constructor(
		readonly kind: 'cache-storage' | 'content-verification' | 'source-stream',
		readonly failure: Error
	) {
		super(failure.message, { cause: failure });
		this.name = 'BucketCacheFailure';
		this.failureChannel =
			kind === 'cache-storage' ? 'scanner_issue' : 'archive_evidence';
	}
}

export class BucketCache {
	private maintenance: Promise<void> | null = null;
	private static readonly maintenanceIntervalMs = 60 * 60 * 1000;
	private static readonly staleLockMs = 2 * 60 * 60 * 1000;

	constructor(
		private readonly rootDirectory: string,
		private readonly maxBytes: number,
		private readonly logger: Logger
	) {}

	async getReadStream(hash: string): Promise<Readable | null> {
		const filePath = this.getBucketPath(hash);
		try {
			await stat(filePath);
			const now = new Date();
			void utimes(filePath, now, now).catch(() => undefined);
			return createReadStream(filePath);
		} catch {
			return null;
		}
	}

	async remove(hash: string): Promise<void> {
		await rm(this.getBucketPath(hash), { force: true });
	}

	async verifyAndStore(
		hash: string,
		source: Readable,
		verify: (stream: Readable) => Promise<Result<void, Error>>
	): Promise<Result<void, BucketCacheFailure>> {
		const finalPath = this.getBucketPath(hash);
		const temporaryPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;

		let sourceError: Error | null = null;
		try {
			await mkdir(dirname(finalPath), { recursive: true });
			const verifyStream = new PassThrough();
			const cacheStream = new PassThrough();
			const writePromise = pipeline(
				cacheStream,
				createWriteStream(temporaryPath)
			);
			const verifyPromise = verify(verifyStream);

			source.on('error', (error) => {
				sourceError = mapUnknownToError(error);
				verifyStream.destroy(error);
				cacheStream.destroy(error);
			});
			source.pipe(verifyStream);
			source.pipe(cacheStream);

			const [verifyResult] = await Promise.all([verifyPromise, writePromise]);
			if (verifyResult.isErr()) {
				await rm(temporaryPath, { force: true });
				return err(
					new BucketCacheFailure(
						sourceError === null ? 'content-verification' : 'source-stream',
						sourceError ?? verifyResult.error
					)
				);
			}

			const temporaryStats = await stat(temporaryPath);
			await this.moveIntoCache(temporaryPath, finalPath);
			this.scheduleMaintenance(temporaryStats.size);
			return ok(undefined);
		} catch (error) {
			await rm(temporaryPath, { force: true }).catch(() => undefined);
			return err(
				new BucketCacheFailure(
					sourceError === null ? 'cache-storage' : 'source-stream',
					sourceError ?? mapUnknownToError(error)
				)
			);
		}
	}

	private async moveIntoCache(
		temporaryPath: string,
		finalPath: string
	): Promise<void> {
		await rename(temporaryPath, finalPath);
	}

	private scheduleMaintenance(incomingBytes: number): void {
		if (this.maintenance !== null) return;
		this.maintenance = this.runMaintenance(incomingBytes)
			.catch((error) => {
				this.logger.warn('History bucket cache maintenance failed', {
					error: mapUnknownToError(error).message
				});
			})
			.finally(() => {
				this.maintenance = null;
			});
	}

	private async runMaintenance(incomingBytes: number): Promise<void> {
		await mkdir(this.rootDirectory, { recursive: true });
		if (await this.wasRecentlyMaintained()) return;
		if (!(await this.acquireMaintenanceLock())) return;

		try {
			if (await this.wasRecentlyMaintained()) return;
			await this.pruneFor(incomingBytes);
			await writeFile(this.maintenanceMarkerPath(), '', { flag: 'w' });
		} finally {
			await rm(this.maintenanceLockPath(), {
				force: true,
				recursive: true
			});
		}
	}

	private async wasRecentlyMaintained(): Promise<boolean> {
		try {
			const marker = await stat(this.maintenanceMarkerPath());
			return Date.now() - marker.mtimeMs < BucketCache.maintenanceIntervalMs;
		} catch {
			return false;
		}
	}

	private async acquireMaintenanceLock(): Promise<boolean> {
		const lockPath = this.maintenanceLockPath();
		try {
			await mkdir(lockPath);
			return true;
		} catch (error) {
			const mapped = mapUnknownToError(error);
			if (!('code' in mapped) || mapped.code !== 'EEXIST') throw mapped;
		}

		try {
			const lock = await stat(lockPath);
			if (Date.now() - lock.mtimeMs < BucketCache.staleLockMs) return false;
			await rm(lockPath, { force: true, recursive: true });
			await mkdir(lockPath);
			return true;
		} catch {
			return false;
		}
	}

	private async pruneFor(incomingBytes: number): Promise<void> {
		const entries = await this.listCacheEntries(this.rootDirectory);
		let totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
		if (totalBytes <= this.maxBytes) return;

		const entriesByAge = [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs);
		let removedFiles = 0;
		for (const entry of entriesByAge) {
			if (totalBytes <= this.maxBytes) break;
			await rm(entry.path, { force: true });
			totalBytes -= entry.size;
			removedFiles++;
		}

		if (removedFiles > 0) {
			this.logger.info('Pruned history bucket cache', {
				removedFiles,
				cacheBytes: totalBytes,
				incomingBytes,
				maxBytes: this.maxBytes
			});
		}
	}

	private maintenanceLockPath(): string {
		return join(this.rootDirectory, '.maintenance-lock');
	}

	private maintenanceMarkerPath(): string {
		return join(this.rootDirectory, '.maintenance-complete');
	}

	private async listCacheEntries(directory: string): Promise<CacheEntry[]> {
		const directoryEntries: Dirent<string>[] = await readdir(directory, {
			withFileTypes: true
		});

		const cacheEntries: CacheEntry[] = [];
		for (const directoryEntry of directoryEntries) {
			const entryPath = join(directory, directoryEntry.name);
			if (directoryEntry.isDirectory()) {
				cacheEntries.push(...(await this.listCacheEntries(entryPath)));
				continue;
			}

			if (!directoryEntry.isFile() || !entryPath.endsWith('.xdr.gz')) continue;
			const entryStats = await stat(entryPath);
			cacheEntries.push({
				path: entryPath,
				size: entryStats.size,
				mtimeMs: entryStats.mtimeMs
			});
		}

		return cacheEntries;
	}

	private getBucketPath(hash: string): string {
		return join(
			this.rootDirectory,
			hash.slice(0, 2),
			hash.slice(2, 4),
			`${hash}.xdr.gz`
		);
	}
}
