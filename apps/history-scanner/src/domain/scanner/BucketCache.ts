import { createReadStream, createWriteStream } from 'node:fs';
import type { Dirent } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises';
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
	private pruneLock: Promise<void> = Promise.resolve();

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
			await this.pruneFor(temporaryStats.size);
			await this.moveIntoCache(temporaryPath, finalPath);
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

	private async pruneFor(incomingBytes: number): Promise<void> {
		const prune = async (): Promise<void> => {
			const entries = await this.listCacheEntries(this.rootDirectory);
			let totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
			if (totalBytes + incomingBytes <= this.maxBytes) return;

			const entriesByAge = [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs);
			let removedFiles = 0;
			for (const entry of entriesByAge) {
				if (totalBytes + incomingBytes <= this.maxBytes) break;
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
		};

		this.pruneLock = this.pruneLock.then(prune, prune);
		await this.pruneLock;
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
