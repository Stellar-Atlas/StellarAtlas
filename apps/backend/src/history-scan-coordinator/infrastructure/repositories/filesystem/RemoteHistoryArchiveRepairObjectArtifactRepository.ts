import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { createWriteStream, type Stats } from 'node:fs';
import {
	mkdir,
	mkdtemp,
	open,
	readFile,
	rmdir,
	unlink,
	type FileHandle
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { canonicalJsonContentDigest } from 'shared/lib/canonical-json-content-digest.js';
import { resolveAppEnvPath } from 'shared/lib/env/resolve-app-env-path.js';
import type {
	HistoryArchiveRepairObjectArtifactInput,
	HistoryArchiveRepairObjectArtifactRepository,
	HistoryArchiveRepairObjectArtifactUnavailable,
	HistoryArchiveRepairObjectArtifactUnavailableReason,
	HistoryArchiveRepairObjectRepresentation,
	OpenHistoryArchiveRepairObjectArtifactResult
} from '../../../domain/history-archive-repair-artifact/HistoryArchiveRepairObjectArtifactRepository.js';
import {
	createHistoryArchiveRepairSourceUrlPolicy,
	type HistoryArchiveRepairHostResolver,
	type HistoryArchiveRepairSourceUrlResolution
} from '../database/HistoryArchiveRepairSourceUrlPolicy.js';
import {
	HistoryArchiveRepairObjectCacheError,
	retainVerifiedBucket
} from './RemoteHistoryArchiveRepairObjectCache.js';
import {
	RemoteHistoryArchiveResponseError,
	requestPinnedRepairObject,
	type RepairObjectHttpRequest
} from './RemoteHistoryArchiveRepairObjectHttp.js';

const digestPattern = /^[0-9a-f]{64}$/;
const defaultMaxCompressedBytes = 2 * 1024 ** 3;
const defaultMaxConcurrentDownloads = 2;
const defaultMaxJsonBytes = 32 * 1024 ** 2;
const defaultMaxUncompressedBytes = 8 * 1024 ** 3;
const defaultTimeoutMs = 5 * 60_000;

export interface RemoteHistoryArchiveRepairObjectArtifactRepositoryOptions {
	readonly bucketCacheDirectory: string;
	readonly hostResolver?: HistoryArchiveRepairHostResolver;
	readonly maxCompressedBytes?: number;
	readonly maxConcurrentDownloads?: number;
	readonly maxJsonBytes?: number;
	readonly maxUncompressedBytes?: number;
	readonly request?: RepairObjectHttpRequest;
	readonly stagingDirectory: string;
	readonly timeoutMs?: number;
}

export class RemoteHistoryArchiveRepairObjectArtifactRepository implements HistoryArchiveRepairObjectArtifactRepository {
	private activeDownloads = 0;
	private readonly bucketCacheDirectory: string;
	private readonly maxCompressedBytes: number;
	private readonly maxConcurrentDownloads: number;
	private readonly maxJsonBytes: number;
	private readonly maxUncompressedBytes: number;
	private readonly request: RepairObjectHttpRequest;
	private readonly sourceUrlPolicy;
	private readonly stagingDirectory: string;
	private readonly timeoutMs: number;

	constructor(
		options: RemoteHistoryArchiveRepairObjectArtifactRepositoryOptions
	) {
		this.bucketCacheDirectory = resolve(options.bucketCacheDirectory);
		this.maxCompressedBytes = positiveInteger(
			options.maxCompressedBytes,
			defaultMaxCompressedBytes
		);
		this.maxConcurrentDownloads = positiveInteger(
			options.maxConcurrentDownloads,
			defaultMaxConcurrentDownloads
		);
		this.maxJsonBytes = positiveInteger(
			options.maxJsonBytes,
			defaultMaxJsonBytes
		);
		this.maxUncompressedBytes = positiveInteger(
			options.maxUncompressedBytes,
			defaultMaxUncompressedBytes
		);
		this.request = options.request ?? requestPinnedRepairObject;
		this.sourceUrlPolicy = createHistoryArchiveRepairSourceUrlPolicy(
			options.hostResolver
		);
		this.stagingDirectory = resolve(options.stagingDirectory);
		this.timeoutMs = positiveInteger(options.timeoutMs, defaultTimeoutMs);
	}

	async openVerifiedObject(
		input: HistoryArchiveRepairObjectArtifactInput
	): Promise<OpenHistoryArchiveRepairObjectArtifactResult> {
		const normalized = normalizeInput(input);
		if (normalized === null) {
			return unavailable('invalid-object-identity');
		}
		const release = this.acquireDownload();
		if (release === null) return unavailable('verification-busy');

		let stage: StagedObject | null = null;
		try {
			const resolution = await this.sourceUrlPolicy.resolveObjectUrl(
				normalized.objectUrl,
				normalized.archiveUrl,
				normalized.archiveUrlIdentity
			);
			stage = await this.download(resolution);
			const opened = await open(
				stage.filePath,
				constants.O_RDONLY | constants.O_NOFOLLOW
			);
			const before = await opened.stat();
			const verified = await this.verify(opened, before, normalized);
			if (verified !== null) {
				await closeHandle(opened);
				await cleanupStage(stage);
				release();
				return unavailable(verified);
			}
			await retainVerifiedBucket({
				bucketCacheDirectory: this.bucketCacheDirectory,
				contentDigest: normalized.contentDigest,
				contentRepresentation: normalized.contentRepresentation,
				objectIdentity: normalized.objectIdentity,
				stagedFilePath: stage.filePath
			});

			const stream = opened.createReadStream({
				autoClose: false,
				end: before.size - 1,
				start: 0
			});
			let closed = false;
			return {
				byteLength: before.size,
				close: async () => {
					if (closed) return;
					closed = true;
					stream.destroy();
					await closeHandle(opened);
					await cleanupStage(stage!);
					release();
				},
				contentDigest: normalized.contentDigest,
				contentRepresentation: normalized.contentRepresentation,
				fileName: safeFileName(
					resolution.url,
					normalized.contentRepresentation
				),
				mediaType:
					normalized.contentRepresentation === 'canonical-json'
						? 'application/json'
						: 'application/gzip',
				objectIdentity: normalized.objectIdentity,
				provenAt: new Date(),
				status: 'available',
				stream
			};
		} catch (error) {
			if (stage !== null) await cleanupStage(stage);
			release();
			return unavailable(reasonForError(error));
		}
	}

	private async download(
		resolution: HistoryArchiveRepairSourceUrlResolution
	): Promise<StagedObject> {
		await mkdir(this.stagingDirectory, { mode: 0o700, recursive: true });
		const directory = await mkdtemp(join(this.stagingDirectory, 'object-'));
		const filePath = join(directory, 'payload');
		const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
		try {
			const response = await this.request(resolution, timeoutSignal);
			if (response.status !== 200) {
				response.body.destroy();
				throw new RemoteResponseError();
			}
			if (
				response.contentLength !== null &&
				response.contentLength > this.maxCompressedBytes
			) {
				response.body.destroy();
				throw new PayloadTooLargeError();
			}
			await pipeline(
				response.body,
				new ByteLimitTransform(this.maxCompressedBytes),
				createWriteStream(filePath, { flags: 'wx', mode: 0o600 }),
				{ signal: timeoutSignal }
			);
			return { directory, filePath };
		} catch (error) {
			await cleanupStage({ directory, filePath });
			throw error;
		}
	}

	private async verify(
		handle: FileHandle,
		before: Stats,
		input: HistoryArchiveRepairObjectArtifactInput
	): Promise<HistoryArchiveRepairObjectArtifactUnavailableReason | null> {
		const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
		let digest: string;
		try {
			digest =
				input.contentRepresentation === 'canonical-json'
					? await this.hashCanonicalJson(handle, before.size)
					: await this.hashUncompressedXdr(handle, before.size, timeoutSignal);
		} catch (error) {
			if (timeoutSignal.aborted) return 'verification-timeout';
			if (error instanceof PayloadTooLargeError) {
				return 'remote-payload-too-large';
			}
			if (isZlibError(error)) return 'invalid-compressed-payload';
			return 'remote-response-invalid';
		}
		const after = await handle.stat();
		if (!sameFileVersion(before, after)) return 'staging-storage-unavailable';
		return digest === input.contentDigest ? null : 'content-hash-mismatch';
	}

	private async hashCanonicalJson(
		handle: FileHandle,
		byteLength: number
	): Promise<string> {
		if (byteLength > this.maxJsonBytes) throw new PayloadTooLargeError();
		const bytes = await readFile(handle);
		const value: unknown = JSON.parse(bytes.toString('utf8'));
		return canonicalJsonContentDigest(value).digest;
	}

	private async hashUncompressedXdr(
		handle: FileHandle,
		byteLength: number,
		signal: AbortSignal
	): Promise<string> {
		const hash = createHash('sha256');
		await pipeline(
			handle.createReadStream({
				autoClose: false,
				end: byteLength - 1,
				start: 0
			}),
			createGunzip(),
			new ByteLimitTransform(this.maxUncompressedBytes),
			hash,
			{ signal }
		);
		return hash.digest('hex');
	}

	private acquireDownload(): (() => void) | null {
		if (this.activeDownloads >= this.maxConcurrentDownloads) return null;
		this.activeDownloads++;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.activeDownloads--;
		};
	}
}

interface StagedObject {
	readonly directory: string;
	readonly filePath: string;
}

class ByteLimitExceededError extends Error {}
class PayloadTooLargeError extends Error {}
class RemoteResponseError extends Error {}

class ByteLimitTransform extends Transform {
	private bytes = 0;

	constructor(private readonly maximumBytes: number) {
		super();
	}

	override _transform(
		chunk: Buffer,
		_encoding: BufferEncoding,
		callback: TransformCallback
	): void {
		this.bytes += chunk.byteLength;
		if (this.bytes > this.maximumBytes) {
			callback(new ByteLimitExceededError());
			return;
		}
		callback(null, chunk);
	}
}

function normalizeInput(
	input: HistoryArchiveRepairObjectArtifactInput
): HistoryArchiveRepairObjectArtifactInput | null {
	const digest = input.contentDigest.trim().toLowerCase();
	if (
		!digestPattern.test(digest) ||
		input.objectIdentity.length === 0 ||
		input.objectIdentity.length > 512
	) {
		return null;
	}
	return { ...input, contentDigest: digest };
}

function safeFileName(
	objectUrl: string,
	representation: HistoryArchiveRepairObjectRepresentation
): string {
	const candidate = basename(new URL(objectUrl).pathname);
	if (/^[A-Za-z0-9._-]{1,200}$/.test(candidate)) return candidate;
	return representation === 'canonical-json'
		? 'history-archive-object.json'
		: 'history-archive-object.xdr.gz';
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

async function cleanupStage(stage: StagedObject): Promise<void> {
	await unlink(stage.filePath).catch(() => undefined);
	await rmdir(stage.directory).catch(() => undefined);
}

async function closeHandle(handle: FileHandle): Promise<void> {
	await handle.close().catch(() => undefined);
}

function reasonForError(
	error: unknown
): HistoryArchiveRepairObjectArtifactUnavailableReason {
	if (
		error instanceof ByteLimitExceededError ||
		error instanceof PayloadTooLargeError
	) {
		return 'remote-payload-too-large';
	}
	if (
		error instanceof RemoteResponseError ||
		error instanceof RemoteHistoryArchiveResponseError
	) {
		return 'remote-response-invalid';
	}
	if (error instanceof HistoryArchiveRepairObjectCacheError) {
		return 'staging-storage-unavailable';
	}
	if (isAbortError(error)) return 'verification-timeout';
	return 'remote-fetch-failed';
}

function unavailable(
	reason: HistoryArchiveRepairObjectArtifactUnavailableReason
): HistoryArchiveRepairObjectArtifactUnavailable {
	const permanent =
		reason === 'content-hash-mismatch' ||
		reason === 'invalid-compressed-payload' ||
		reason === 'invalid-object-identity' ||
		reason === 'remote-payload-too-large' ||
		reason === 'remote-response-invalid';
	return {
		reason,
		retryAfterSeconds: permanent
			? null
			: reason === 'verification-busy'
				? 5
				: 60,
		retryable: !permanent,
		status: 'unavailable'
	};
}

function isAbortError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		(error.name === 'AbortError' || error.name === 'TimeoutError')
	);
}

function isZlibError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		typeof error.code === 'string' &&
		error.code.startsWith('Z_')
	);
}

function positiveInteger(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isSafeInteger(value) && value > 0
		? value
		: fallback;
}

export function createRemoteHistoryArchiveRepairObjectArtifactRepository(): RemoteHistoryArchiveRepairObjectArtifactRepository {
	const bucketRoot =
		process.env.HISTORY_BUCKET_CACHE_DIR ??
		resolve(
			dirname(resolveAppEnvPath(import.meta.url, 'backend')),
			'..',
			'..',
			'history-bucket-cache'
		);
	return new RemoteHistoryArchiveRepairObjectArtifactRepository({
		bucketCacheDirectory: bucketRoot,
		stagingDirectory:
			process.env.HISTORY_ARCHIVE_REPAIR_STAGING_DIR ??
			join(bucketRoot, '.repair-staging')
	});
}
