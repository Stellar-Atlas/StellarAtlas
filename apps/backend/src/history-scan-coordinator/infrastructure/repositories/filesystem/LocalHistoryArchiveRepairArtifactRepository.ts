import { constants, type Stats } from 'node:fs';
import { open, realpath, type FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Transform, type Readable, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import type {
	HistoryArchiveRepairArtifactInspection,
	HistoryArchiveRepairArtifactProof,
	HistoryArchiveRepairArtifactRepository,
	HistoryArchiveRepairArtifactUnavailable,
	HistoryArchiveRepairArtifactUnavailableReason,
	OpenHistoryArchiveRepairArtifactResult
} from '../../../domain/history-archive-repair-artifact/HistoryArchiveRepairArtifactRepository.js';
import { historyArchiveBucketHashPattern } from '../../../domain/history-archive-repair-artifact/HistoryArchiveRepairArtifactRepository.js';

const defaultMaxCompressedBytes = 8 * 1024 ** 3;
const defaultMaxConcurrentVerifications = 2;
const defaultMaxUncompressedBytes = 64 * 1024 ** 3;
const defaultVerificationTimeoutMs = 5 * 60_000;

export interface LocalHistoryArchiveRepairArtifactRepositoryOptions {
	readonly maxCompressedBytes?: number;
	readonly maxConcurrentVerifications?: number;
	readonly maxUncompressedBytes?: number;
	readonly rootDirectory: string;
	readonly verificationTimeoutMs?: number;
}

type ProvenHandle = {
	readonly handle: FileHandle;
	readonly proof: HistoryArchiveRepairArtifactProof;
	readonly release: () => void;
};

type DigestResult =
	| { readonly digest: string; readonly status: 'ok' }
	| {
			readonly reason:
				| 'invalid-compressed-payload'
				| 'local-payload-too-large'
				| 'local-storage-unavailable'
				| 'verification-timeout';
			readonly status: 'failed';
	  };

export class LocalHistoryArchiveRepairArtifactRepository implements HistoryArchiveRepairArtifactRepository {
	private readonly maxCompressedBytes: number;
	private readonly maxConcurrentVerifications: number;
	private readonly maxUncompressedBytes: number;
	private readonly rootDirectory: string;
	private readonly verificationTimeoutMs: number;
	private activeVerifications = 0;

	constructor(options: LocalHistoryArchiveRepairArtifactRepositoryOptions) {
		this.rootDirectory = resolve(options.rootDirectory);
		this.maxCompressedBytes = positiveInteger(
			options.maxCompressedBytes,
			defaultMaxCompressedBytes
		);
		this.maxConcurrentVerifications = positiveInteger(
			options.maxConcurrentVerifications,
			defaultMaxConcurrentVerifications
		);
		this.maxUncompressedBytes = positiveInteger(
			options.maxUncompressedBytes,
			defaultMaxUncompressedBytes
		);
		this.verificationTimeoutMs = positiveInteger(
			options.verificationTimeoutMs,
			defaultVerificationTimeoutMs
		);
	}

	async inspectBucket(
		bucketHash: string
	): Promise<HistoryArchiveRepairArtifactInspection> {
		const proven = await this.openProvenHandle(bucketHash);
		if ('status' in proven) return proven;
		await closeHandle(proven.handle);
		proven.release();
		return proven.proof;
	}

	async openBucket(
		bucketHash: string
	): Promise<OpenHistoryArchiveRepairArtifactResult> {
		const proven = await this.openProvenHandle(bucketHash);
		if ('status' in proven) return proven;

		let stream: Readable;
		try {
			stream = proven.handle.createReadStream({
				autoClose: false,
				end: proven.proof.byteLength - 1,
				start: 0
			});
		} catch {
			await closeHandle(proven.handle);
			proven.release();
			return unavailable(proven.proof.bucketHash, 'local-storage-unavailable');
		}

		let closed = false;
		return {
			...proven.proof,
			close: async () => {
				if (closed) return;
				closed = true;
				stream.destroy();
				await closeHandle(proven.handle);
				proven.release();
			},
			stream
		};
	}

	private async openProvenHandle(
		requestedHash: string
	): Promise<ProvenHandle | HistoryArchiveRepairArtifactUnavailable> {
		const bucketHash = normalizeBucketHash(requestedHash);
		if (bucketHash === null) {
			return unavailable(null, 'invalid-object-identity');
		}

		const release = this.acquireVerification();
		if (release === null) return unavailable(bucketHash, 'verification-busy');

		let handle: FileHandle | null = null;
		try {
			const filePath = this.resolveBucketPath(bucketHash);
			if (filePath === null) {
				release();
				return unavailable(null, 'invalid-object-identity');
			}
				const resolvedRoot = await realpath(this.rootDirectory);
				handle = await open(
					filePath,
					constants.O_RDONLY | constants.O_NOATIME | constants.O_NOFOLLOW
				);
				const openedFile = await realpath(`/proc/self/fd/${handle.fd}`);
				if (!isWithin(resolvedRoot, openedFile)) {
					await closeHandle(handle);
					release();
					return unavailable(bucketHash, 'local-storage-unavailable');
				}
				const before = await handle.stat();
			if (!before.isFile()) {
				await closeHandle(handle);
				release();
				return unavailable(bucketHash, 'local-payload-not-regular');
			}
			if (before.size < 1 || before.size > this.maxCompressedBytes) {
				await closeHandle(handle);
				release();
				return unavailable(bucketHash, 'local-payload-too-large');
			}

			const digest = await this.hashUncompressed(handle, before.size);
			const after = await handle.stat();
			if (!sameFileVersion(before, after)) {
				await closeHandle(handle);
				release();
				return unavailable(bucketHash, 'local-storage-unavailable');
			}
			if (digest.status === 'failed') {
				await closeHandle(handle);
				release();
				return unavailable(bucketHash, digest.reason);
			}
			if (digest.digest !== bucketHash) {
				await closeHandle(handle);
				release();
				return unavailable(bucketHash, 'content-hash-mismatch');
			}

			return {
				handle,
				proof: {
					bucketHash,
					byteLength: before.size,
					provenAt: new Date(),
					status: 'available'
				},
				release
			};
		} catch (error) {
			if (handle !== null) await closeHandle(handle);
			release();
			return unavailable(bucketHash, reasonForFileError(error));
		}
	}

	private async hashUncompressed(
		handle: FileHandle,
		compressedBytes: number
	): Promise<DigestResult> {
		const abortController = new AbortController();
		const timeout = setTimeout(
			() => abortController.abort(),
			this.verificationTimeoutMs
		);
		timeout.unref();
		const hasher = createHash('sha256');

		try {
			await pipeline(
				handle.createReadStream({
					autoClose: false,
					end: compressedBytes - 1,
					start: 0
				}),
				createGunzip(),
				new ByteLimitTransform(this.maxUncompressedBytes),
				hasher,
				{ signal: abortController.signal }
			);
			return { digest: hasher.digest('hex'), status: 'ok' };
		} catch (error) {
			if (abortController.signal.aborted) {
				return { reason: 'verification-timeout', status: 'failed' };
			}
			if (error instanceof ByteLimitExceededError) {
				return { reason: 'local-payload-too-large', status: 'failed' };
			}
			if (isZlibError(error)) {
				return { reason: 'invalid-compressed-payload', status: 'failed' };
			}
			return { reason: 'local-storage-unavailable', status: 'failed' };
		} finally {
			clearTimeout(timeout);
		}
	}

	private acquireVerification(): (() => void) | null {
		if (this.activeVerifications >= this.maxConcurrentVerifications)
			return null;
		this.activeVerifications++;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.activeVerifications--;
		};
	}

	private resolveBucketPath(bucketHash: string): string | null {
		const filePath = resolve(
			this.rootDirectory,
			bucketHash.slice(0, 2),
			bucketHash.slice(2, 4),
			`${bucketHash}.xdr.gz`
		);
		return isWithin(this.rootDirectory, filePath) ? filePath : null;
	}
}

class ByteLimitExceededError extends Error {}

class ByteLimitTransform extends Transform {
	private bytes = 0;

	constructor(private readonly maxBytes: number) {
		super();
	}

	override _transform(
		chunk: Buffer,
		_encoding: BufferEncoding,
		callback: TransformCallback
	): void {
		this.bytes += chunk.byteLength;
		if (this.bytes > this.maxBytes) {
			callback(new ByteLimitExceededError());
			return;
		}
		callback(null, chunk);
	}
}

function unavailable(
	bucketHash: string | null,
	reason: HistoryArchiveRepairArtifactUnavailableReason
): HistoryArchiveRepairArtifactUnavailable {
	if (
		reason === 'invalid-object-identity' ||
		reason === 'local-payload-too-large'
	) {
		return {
			bucketHash,
			reason,
			retryAfterSeconds: null,
			retryable: false,
			status: 'unavailable'
		};
	}
	return {
		bucketHash,
		reason,
		retryAfterSeconds: reason === 'verification-busy' ? 5 : 60,
		retryable: true,
		status: 'unavailable'
	};
}

function normalizeBucketHash(value: string): string | null {
	const normalized = value.trim().toLowerCase();
	return historyArchiveBucketHashPattern.test(normalized) ? normalized : null;
}

function isWithin(rootDirectory: string, filePath: string): boolean {
	const pathFromRoot = relative(rootDirectory, filePath);
	return (
		pathFromRoot !== '..' &&
		!pathFromRoot.startsWith(`..${sep}`) &&
		!isAbsolute(pathFromRoot)
	);
}

function sameFileVersion(before: Stats, after: Stats): boolean {
	return (
		before.dev === after.dev &&
		before.ino === after.ino &&
		before.size === after.size &&
		before.mtimeMs === after.mtimeMs &&
		before.ctimeMs === after.ctimeMs
	);
}

function reasonForFileError(
	error: unknown
): HistoryArchiveRepairArtifactUnavailableReason {
	const code = errorCode(error);
	if (code === 'ENOENT' || code === 'ENOTDIR') return 'local-payload-missing';
	if (code === 'ELOOP') return 'local-payload-not-regular';
	return 'local-storage-unavailable';
}

function isZlibError(error: unknown): boolean {
	return errorCode(error)?.startsWith('Z_') === true;
}

function errorCode(error: unknown): string | null {
	if (typeof error !== 'object' || error === null || !('code' in error)) {
		return null;
	}
	return typeof error.code === 'string' ? error.code : null;
}

function positiveInteger(value: number | undefined, fallback: number): number {
	return Number.isSafeInteger(value) && value !== undefined && value > 0
		? value
		: fallback;
}

async function closeHandle(handle: FileHandle): Promise<void> {
	await handle.close().catch(() => undefined);
}

export function createLocalHistoryArchiveRepairArtifactRepository(): LocalHistoryArchiveRepairArtifactRepository {
	return new LocalHistoryArchiveRepairArtifactRepository({
		rootDirectory:
			process.env.HISTORY_BUCKET_CACHE_DIR ?? 'history-bucket-cache'
	});
}
