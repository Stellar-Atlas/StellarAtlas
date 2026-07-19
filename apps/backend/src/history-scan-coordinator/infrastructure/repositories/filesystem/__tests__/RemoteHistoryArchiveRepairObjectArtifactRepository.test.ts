import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { canonicalJsonContentDigest } from 'shared/lib/canonical-json-content-digest.js';
import type { HistoryArchiveRepairObjectArtifactInput } from '../../../../domain/history-archive-repair-artifact/HistoryArchiveRepairObjectArtifactRepository.js';
import { RemoteHistoryArchiveRepairObjectArtifactRepository } from '../RemoteHistoryArchiveRepairObjectArtifactRepository.js';
import type { RepairObjectHttpRequest } from '../RemoteHistoryArchiveRepairObjectHttp.js';

describe('RemoteHistoryArchiveRepairObjectArtifactRepository', () => {
	let rootDirectory: string;

	beforeEach(async () => {
		rootDirectory = await mkdtemp(join(tmpdir(), 'repair-object-'));
	});

	afterEach(async () => {
		await rm(rootDirectory, { force: true, recursive: true });
	});

	it('returns compressed XDR bytes only after the uncompressed digest matches', async () => {
		const payload = Buffer.from('verified transaction archive XDR');
		const compressed = gzipSync(payload);
		const repository = createRepository(compressed);

		const result = await repository.openVerifiedObject(
			createInput(sha256(payload))
		);

		expect(result).toMatchObject({
			byteLength: compressed.byteLength,
			contentDigest: sha256(payload),
			contentRepresentation: 'uncompressed-xdr',
			status: 'available'
		});
		if (result.status === 'unavailable') return;
		await expect(readAll(result.stream)).resolves.toEqual(compressed);
		await result.close();
	});

	it('rejects a source whose downloaded bytes do not match the proof digest', async () => {
		const repository = createRepository(
			gzipSync(Buffer.from('different transaction archive XDR'))
		);

		await expect(
			repository.openVerifiedObject(createInput('a'.repeat(64)))
		).resolves.toEqual({
			reason: 'content-hash-mismatch',
			retryAfterSeconds: null,
			retryable: false,
			status: 'unavailable'
		});
	});

	it('uses canonical JSON content for checkpoint-state proof verification', async () => {
		const bytes = Buffer.from('{"currentLedger":63,"version":1}\n');
		const digest = canonicalJsonContentDigest({
			version: 1,
			currentLedger: 63
		}).digest;
		const repository = createRepository(bytes);

		const result = await repository.openVerifiedObject({
			...createInput(digest),
			contentRepresentation: 'canonical-json',
			objectIdentity: 'checkpoint-state:0000003f',
			objectUrl: 'https://source.example/history/00/00/00/history-0000003f.json'
		});

		expect(result).toMatchObject({
			contentDigest: digest,
			mediaType: 'application/json',
			status: 'available'
		});
		if (result.status === 'unavailable') return;
		await expect(readAll(result.stream)).resolves.toEqual(bytes);
		await result.close();
	});

	it('holds the bounded download lease until the caller closes the artifact', async () => {
		const payload = Buffer.from('verified transaction archive XDR');
		const compressed = gzipSync(payload);
		const repository = createRepository(compressed, 1);
		const first = await repository.openVerifiedObject(
			createInput(sha256(payload))
		);
		expect(first.status).toBe('available');

		await expect(
			repository.openVerifiedObject(createInput(sha256(payload)))
		).resolves.toMatchObject({
			reason: 'verification-busy',
			retryAfterSeconds: 5,
			status: 'unavailable'
		});
		if (first.status === 'available') await first.close();
		const second = await repository.openVerifiedObject(
			createInput(sha256(payload))
		);
		expect(second.status).toBe('available');
		if (second.status === 'available') await second.close();
	});

	it('retains one verified bucket payload under its content hash', async () => {
		const payload = Buffer.from('verified bucket XDR');
		const digest = sha256(payload);
		const compressed = gzipSync(payload);
		const repository = createRepository(compressed);

		const result = await repository.openVerifiedObject({
			...createInput(digest),
			objectIdentity: `bucket:${digest}`,
			objectUrl: `https://source.example/history/bucket/${digest.slice(0, 2)}/${digest.slice(2, 4)}/${digest.slice(4, 6)}/bucket-${digest}.xdr.gz`
		});

		expect(result.status).toBe('available');
		if (result.status === 'available') await result.close();
		await expect(
			readFile(
				join(
					rootDirectory,
					digest.slice(0, 2),
					digest.slice(2, 4),
					`${digest}.xdr.gz`
				)
			)
		).resolves.toEqual(compressed);
	});

	it('does not request a source that resolves to a private address', async () => {
		const requestMock = jest.fn(async () => {
			throw new Error('request must not be called');
		});
		const request: RepairObjectHttpRequest = requestMock;
		const repository = new RemoteHistoryArchiveRepairObjectArtifactRepository({
			bucketCacheDirectory: rootDirectory,
			hostResolver: async () => ['127.0.0.1'],
			request,
			stagingDirectory: rootDirectory
		});

		await expect(
			repository.openVerifiedObject(createInput('a'.repeat(64)))
		).resolves.toMatchObject({
			reason: 'remote-fetch-failed',
			status: 'unavailable'
		});
		expect(requestMock).not.toHaveBeenCalled();
	});

	function createRepository(
		body: Uint8Array,
		maxConcurrentDownloads = 2
	): RemoteHistoryArchiveRepairObjectArtifactRepository {
		return new RemoteHistoryArchiveRepairObjectArtifactRepository({
			bucketCacheDirectory: rootDirectory,
			hostResolver: async () => ['93.184.216.34'],
			maxCompressedBytes: 4_096,
			maxConcurrentDownloads,
			maxJsonBytes: 4_096,
			maxUncompressedBytes: 4_096,
			request: async () => ({
				body: Readable.from([body]),
				contentLength: body.byteLength,
				status: 200
			}),
			stagingDirectory: rootDirectory,
			timeoutMs: 5_000
		});
	}
});

function createInput(
	contentDigest: string
): HistoryArchiveRepairObjectArtifactInput {
	return {
		archiveUrl: 'https://source.example/history',
		archiveUrlIdentity: 'https://source.example/history',
		contentDigest,
		contentRepresentation: 'uncompressed-xdr',
		objectIdentity: 'transactions:0000003f',
		objectUrl:
			'https://source.example/history/transactions/00/00/00/transactions-0000003f.xdr.gz'
	};
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
