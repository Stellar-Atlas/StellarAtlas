import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { mock } from 'jest-mock-extended';
import type { Logger } from 'logger';
import { err, ok } from 'neverthrow';
import { BucketCache } from '../BucketCache.js';

describe('BucketCache failure channels', () => {
	let temporaryDirectory: string;

	beforeEach(async () => {
		temporaryDirectory = await mkdtemp(join(tmpdir(), 'archive-bucket-cache-'));
	});

	afterEach(async () => {
		await rm(temporaryDirectory, { force: true, recursive: true });
	});

	it('classifies remote content verification as archive evidence', async () => {
		const cache = new BucketCache(temporaryDirectory, 1024, mock<Logger>());

		const result = await cache.verifyAndStore(
			'a'.repeat(64),
			Readable.from(Buffer.from('remote bytes')),
			async () => err(new Error('hash mismatch'))
		);

		expect(result._unsafeUnwrapErr()).toMatchObject({
			failureChannel: 'archive_evidence',
			kind: 'content-verification',
			message: 'hash mismatch'
		});
	});

	it('classifies remote stream aborts separately from content failures', async () => {
		const cache = new BucketCache(temporaryDirectory, 1024, mock<Logger>());
		const source = new Readable({
			read() {
				this.destroy(new Error('aborted'));
			}
		});

		const result = await cache.verifyAndStore(
			'a'.repeat(64),
			source,
			async (stream) => {
				try {
					await pipeline(stream, async function* (chunks) {
						for await (const chunk of chunks) yield chunk;
					});
					return ok(undefined);
				} catch (error) {
					return err(error instanceof Error ? error : new Error(String(error)));
				}
			}
		);

		expect(result._unsafeUnwrapErr()).toMatchObject({
			failureChannel: 'archive_evidence',
			kind: 'source-stream',
			message: 'aborted'
		});
	});

	it('classifies local cache setup failures as scanner issues', async () => {
		const cacheRoot = join(temporaryDirectory, 'not-a-directory');
		await writeFile(cacheRoot, 'file');
		const cache = new BucketCache(cacheRoot, 1024, mock<Logger>());

		const result = await cache.verifyAndStore(
			'b'.repeat(64),
			Readable.from(Buffer.from('remote bytes')),
			async () => {
				throw new Error('verification must not run');
			}
		);

		expect(result._unsafeUnwrapErr()).toMatchObject({
			failureChannel: 'scanner_issue',
			kind: 'cache-storage'
		});
	});

	it('verifies without touching a cache root that is a regular file', async () => {
		const cacheRoot = join(temporaryDirectory, 'cache-root-file');
		await writeFile(cacheRoot, 'root remains a file');
		const cache = new BucketCache(cacheRoot, 1024, mock<Logger>());
		let verified = '';

		const result = await cache.verifyOnly(
			Readable.from(Buffer.from('remote bytes')),
			async (stream) => {
				for await (const chunk of stream) verified += chunk.toString();
				return ok(undefined);
			}
		);

		expect(result.isOk()).toBe(true);
		expect(verified).toBe('remote bytes');
		expect(await readFile(cacheRoot, 'utf8')).toBe('root remains a file');
	});

	it('preserves content and source-stream failure classifications in verifyOnly', async () => {
		const cache = new BucketCache(temporaryDirectory, 1024, mock<Logger>());
		const mismatch = await cache.verifyOnly(
			Readable.from(Buffer.from('remote bytes')),
			async () => err(new Error('hash mismatch'))
		);
		expect(mismatch._unsafeUnwrapErr()).toMatchObject({
			failureChannel: 'archive_evidence',
			kind: 'content-verification',
			message: 'hash mismatch'
		});

		const source = new Readable({
			read() {
				this.destroy(new Error('aborted'));
			}
		});
		const sourceFailure = await cache.verifyOnly(source, async (stream) => {
			try {
				await pipeline(stream, async function* (chunks) {
					for await (const chunk of chunks) yield chunk;
				});
				return ok(undefined);
			} catch (error) {
				return err(error instanceof Error ? error : new Error(String(error)));
			}
		});
		expect(sourceFailure._unsafeUnwrapErr()).toMatchObject({
			failureChannel: 'archive_evidence',
			kind: 'source-stream',
			message: 'aborted'
		});
	});

	it('classifies invalid gzip as content verification and destroys its source', async () => {
		const cache = new BucketCache(temporaryDirectory, 1024, mock<Logger>());
		const source = new Readable({
			read() {
				this.push(Buffer.from('not gzip data'));
			}
		});

		const result = await cache.verifyOnly(source, async (stream) => {
			try {
				await pipeline(stream, createGunzip(), createHash('sha256'));
				return ok(undefined);
			} catch (error) {
				return err(error instanceof Error ? error : new Error(String(error)));
			}
		});

		expect(result._unsafeUnwrapErr()).toMatchObject({
			failureChannel: 'archive_evidence',
			kind: 'content-verification'
		});
		expect(source.destroyed).toBe(true);
	});

	it('does not block a verified write on a fresh shared maintenance marker', async () => {
		const existingHash = 'c'.repeat(64);
		const existingDirectory = join(
			temporaryDirectory,
			existingHash.slice(0, 2),
			existingHash.slice(2, 4)
		);
		await mkdir(existingDirectory, { recursive: true });
		await writeFile(join(temporaryDirectory, '.maintenance-complete'), '');
		await writeFile(
			join(existingDirectory, `${existingHash}.xdr.gz`),
			Buffer.alloc(64)
		);

		const cache = new BucketCache(temporaryDirectory, 1, mock<Logger>());
		const newHash = 'd'.repeat(64);
		const result = await cache.verifyAndStore(
			newHash,
			Readable.from(Buffer.from('verified bytes')),
			async (stream) => {
				for await (const _chunk of stream) {
					// Consume the verification branch.
				}
				return ok(undefined);
			}
		);

		expect(result.isOk()).toBe(true);
		expect(
			await readFile(
				join(
					temporaryDirectory,
					newHash.slice(0, 2),
					newHash.slice(2, 4),
					`${newHash}.xdr.gz`
				)
			)
		).toEqual(Buffer.from('verified bytes'));
		expect(
			await readFile(join(existingDirectory, `${existingHash}.xdr.gz`))
		).toEqual(Buffer.alloc(64));
	});
});
