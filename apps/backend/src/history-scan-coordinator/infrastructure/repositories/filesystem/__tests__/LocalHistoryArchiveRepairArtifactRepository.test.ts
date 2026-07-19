import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { LocalHistoryArchiveRepairArtifactRepository } from '../LocalHistoryArchiveRepairArtifactRepository.js';

describe('LocalHistoryArchiveRepairArtifactRepository', () => {
	let rootDirectory: string;

	beforeEach(async () => {
		rootDirectory = await mkdtemp(join(tmpdir(), 'repair-artifacts-'));
	});

	afterEach(async () => {
		await rm(rootDirectory, { force: true, recursive: true });
	});

	it('opens exact locally retained gzip bytes after proving the uncompressed bucket hash', async () => {
		const payload = Buffer.from('known-good bucket xdr');
		const bucketHash = sha256(payload);
		const compressed = gzipSync(payload);
		await writeBucket(rootDirectory, bucketHash, compressed);
		const repository = createRepository(rootDirectory);

		const result = await repository.openBucket(bucketHash.toUpperCase());

		expect(result).toMatchObject({
			bucketHash,
			byteLength: compressed.byteLength,
			status: 'available'
		});
		if (result.status === 'unavailable') return;
		await expect(readAll(result.stream)).resolves.toEqual(compressed);
		await result.close();
	});

	it('returns unavailable evidence when retained bytes do not match the requested hash', async () => {
		const requestedHash = 'a'.repeat(64);
		await writeBucket(
			rootDirectory,
			requestedHash,
			gzipSync(Buffer.from('different bucket payload'))
		);
		const repository = createRepository(rootDirectory);

		await expect(repository.inspectBucket(requestedHash)).resolves.toEqual({
			bucketHash: requestedHash,
			reason: 'content-hash-mismatch',
			retryAfterSeconds: 60,
			retryable: true,
			status: 'unavailable'
		});
	});

	it('checks presence cheaply but still rehashes before download', async () => {
		const requestedHash = 'd'.repeat(64);
		const compressed = gzipSync(Buffer.from('different bucket payload'));
		await writeBucket(rootDirectory, requestedHash, compressed);
		const repository = createRepository(rootDirectory);

		await expect(
			repository.inspectBucketPresence(requestedHash)
		).resolves.toEqual({
			bucketHash: requestedHash,
			byteLength: compressed.byteLength,
			status: 'present'
		});
		await expect(repository.openBucket(requestedHash)).resolves.toMatchObject({
			reason: 'content-hash-mismatch',
			status: 'unavailable'
		});
	});

	it('returns retry evidence when the local payload is missing', async () => {
		const bucketHash = 'b'.repeat(64);
		const repository = createRepository(rootDirectory);

		await expect(repository.inspectBucket(bucketHash)).resolves.toEqual({
			bucketHash,
			reason: 'local-payload-missing',
			retryAfterSeconds: 60,
			retryable: true,
			status: 'unavailable'
		});
	});

	it('rejects traversal input before resolving a cache path', async () => {
		const repository = createRepository(rootDirectory);

		const result = await repository.openBucket('../outside/cache-payload');

		expect(result).toEqual({
			bucketHash: null,
			reason: 'invalid-object-identity',
			retryAfterSeconds: null,
			retryable: false,
			status: 'unavailable'
		});
		expect(JSON.stringify(result)).not.toContain(rootDirectory);
	});

	it('rejects a file descriptor opened through an escaping directory symlink', async () => {
		const payload = Buffer.from('outside retained bucket');
		const bucketHash = sha256(payload);
		const outsideDirectory = await mkdtemp(
			join(tmpdir(), 'repair-artifacts-outside-')
		);
		try {
			await writeBucket(outsideDirectory, bucketHash, gzipSync(payload));
			await symlink(
				join(outsideDirectory, bucketHash.slice(0, 2)),
				join(rootDirectory, bucketHash.slice(0, 2)),
				'dir'
			);
			const repository = createRepository(rootDirectory);

			await expect(repository.inspectBucket(bucketHash)).resolves.toEqual({
				bucketHash,
				reason: 'local-storage-unavailable',
				retryAfterSeconds: 60,
				retryable: true,
				status: 'unavailable'
			});
		} finally {
			await rm(outsideDirectory, { force: true, recursive: true });
		}
	});

	it('does not accept a malformed gzip payload as a repair artifact', async () => {
		const bucketHash = 'c'.repeat(64);
		await writeBucket(rootDirectory, bucketHash, Buffer.from('not gzip'));
		const repository = createRepository(rootDirectory);

		await expect(repository.inspectBucket(bucketHash)).resolves.toMatchObject({
			reason: 'invalid-compressed-payload',
			status: 'unavailable'
		});
	});

	it('bounds concurrent proof and download leases', async () => {
		const firstPayload = Buffer.from('first retained bucket');
		const secondPayload = Buffer.from('second retained bucket');
		const firstHash = sha256(firstPayload);
		const secondHash = sha256(secondPayload);
		await writeBucket(rootDirectory, firstHash, gzipSync(firstPayload));
		await writeBucket(rootDirectory, secondHash, gzipSync(secondPayload));
		const repository = createRepository(rootDirectory);
		const first = await repository.openBucket(firstHash);
		expect(first.status).toBe('available');

		await expect(repository.inspectBucket(secondHash)).resolves.toMatchObject({
			reason: 'verification-busy',
			retryAfterSeconds: 5,
			status: 'unavailable'
		});
		if (first.status === 'available') await first.close();
		await expect(repository.inspectBucket(secondHash)).resolves.toMatchObject({
			bucketHash: secondHash,
			status: 'available'
		});
	});

	it('rejects a retained payload above the configured compressed-byte cap', async () => {
		const payload = Buffer.alloc(2_048, 7);
		const bucketHash = sha256(payload);
		await writeBucket(rootDirectory, bucketHash, gzipSync(payload));
		const repository = new LocalHistoryArchiveRepairArtifactRepository({
			maxCompressedBytes: 8,
			rootDirectory
		});

		await expect(repository.inspectBucket(bucketHash)).resolves.toEqual({
			bucketHash,
			reason: 'local-payload-too-large',
			retryAfterSeconds: null,
			retryable: false,
			status: 'unavailable'
		});
	});
});

function createRepository(rootDirectory: string) {
	return new LocalHistoryArchiveRepairArtifactRepository({
		maxCompressedBytes: 1024,
		maxConcurrentVerifications: 1,
		maxUncompressedBytes: 4096,
		rootDirectory,
		verificationTimeoutMs: 5_000
	});
}

async function writeBucket(
	rootDirectory: string,
	bucketHash: string,
	payload: Uint8Array
): Promise<void> {
	const filePath = join(
		rootDirectory,
		bucketHash.slice(0, 2),
		bucketHash.slice(2, 4),
		`${bucketHash}.xdr.gz`
	);
	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, payload);
}

function sha256(payload: Uint8Array): string {
	return createHash('sha256').update(payload).digest('hex');
}

async function readAll(stream: Readable): Promise<Buffer> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of stream) {
		if (typeof chunk === 'string') chunks.push(Buffer.from(chunk));
		else if (chunk instanceof Uint8Array) chunks.push(chunk);
		else throw new Error('Repair artifact stream returned an invalid chunk');
	}
	return Buffer.concat(chunks);
}
