import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { createWriteStream, type Stats } from 'node:fs';
import { open, readFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { canonicalJsonContentDigest } from 'shared/lib/canonical-json-content-digest.js';
import type {
	HistoryArchiveRepairObjectArtifactInput,
	HistoryArchiveRepairObjectArtifactRepository,
	HistoryArchiveRepairObjectArtifactUnavailable,
	HistoryArchiveRepairObjectArtifactUnavailableReason,
	HistoryArchiveRepairObjectRepresentation,
	OpenHistoryArchiveRepairObjectArtifactResult
} from '../../../domain/history-archive-repair-artifact/HistoryArchiveRepairObjectArtifactRepository.js';
import type { HistoryArchiveRepairArtifactWorkPermit } from '../../../domain/history-archive-repair-artifact/HistoryArchiveRepairArtifactWorkPermit.js';
import {
	createHistoryArchiveRepairSourceUrlPolicy,
	type HistoryArchiveRepairHostResolver,
	type HistoryArchiveRepairSourceUrlResolution
} from '../database/HistoryArchiveRepairSourceUrlPolicy.js';
import {
	RemoteHistoryArchiveResponseError,
	requestPinnedRepairObject,
	type RepairObjectHttpRequest
} from './RemoteHistoryArchiveRepairObjectHttp.js';
import {
	cleanupRepairStage,
	createRepairStageDirectory,
	prepareRepairStagingDirectory,
	StagingCapacityError,
	type StagedRepairObject
} from './RemoteHistoryArchiveRepairObjectStaging.js';

const digestPattern = /^[0-9a-f]{64}$/;
const defaultMaxCompressedBytes = 2 * 1024 ** 3;
const defaultMaxConcurrentDownloads = 2;
const defaultMaxJsonBytes = 4 * 1024 ** 2;
const defaultMaxUncompressedBytes = 8 * 1024 ** 3;
const defaultTimeoutMs = 5 * 60_000;
const maxCanonicalJsonDepth = 64;
const maxCanonicalJsonNodes = 100_000;

export interface RemoteHistoryArchiveRepairObjectArtifactRepositoryOptions {
	readonly hostResolver?: HistoryArchiveRepairHostResolver;
	readonly maxCompressedBytes?: number;
	readonly maxConcurrentDownloads?: number;
	readonly maxJsonBytes?: number;
	readonly maxUncompressedBytes?: number;
	readonly request?: RepairObjectHttpRequest;
	readonly stagingDirectory: string;
	readonly timeoutMs?: number;
	readonly workPermit: HistoryArchiveRepairArtifactWorkPermit;
}

export class RemoteHistoryArchiveRepairObjectArtifactRepository implements HistoryArchiveRepairObjectArtifactRepository {
	private activeDownloads = 0;
	private readonly maxCompressedBytes: number;
	private readonly maxConcurrentDownloads: number;
	private readonly maxJsonBytes: number;
	private readonly maxUncompressedBytes: number;
	private readonly request: RepairObjectHttpRequest;
	private readonly sourceUrlPolicy;
	private readonly stagingDirectory: string;
	private readonly timeoutMs: number;
	private readonly workPermit: HistoryArchiveRepairArtifactWorkPermit;

	constructor(
		options: RemoteHistoryArchiveRepairObjectArtifactRepositoryOptions
	) {
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
		this.workPermit = options.workPermit;
	}

	async openVerifiedObject(
		input: HistoryArchiveRepairObjectArtifactInput
	): Promise<OpenHistoryArchiveRepairObjectArtifactResult> {
		const normalized = normalizeInput(input);
		if (normalized === null) {
			return unavailable('invalid-object-identity');
		}
		const globalLease = await this.workPermit.tryAcquire();
		if (globalLease === null) return unavailable('verification-busy');
		const releaseProcessSlot = this.acquireDownload();
		if (releaseProcessSlot === null) {
			await globalLease.release();
			return unavailable('verification-busy');
		}
		let released = false;
		const release = async (): Promise<void> => {
			if (released) return;
			released = true;
			releaseProcessSlot();
			await globalLease.release();
		};

		let stage: StagedRepairObject | null = null;
		let opened: FileHandle | null = null;
		try {
			const resolution = await this.sourceUrlPolicy.resolveObjectUrl(
				normalized.objectUrl,
				normalized.archiveUrl,
				normalized.archiveUrlIdentity
			);
			stage = await this.download(resolution, normalized.contentRepresentation);
			opened = await open(
				stage.filePath,
				constants.O_RDONLY | constants.O_NOFOLLOW
			);
			const before = await opened.stat();
			const verified = await this.verify(opened, before, normalized);
			if (verified !== null) {
				await closeHandle(opened);
				await cleanupRepairStage(stage);
				await release();
				return unavailable(verified);
			}
			const stream = opened.createReadStream({
				autoClose: false,
				end: before.size - 1,
				start: 0
			});
			const openedHandle = opened;
			let closed = false;
			return {
				byteLength: before.size,
				close: async () => {
					if (closed) return;
					closed = true;
					stream.destroy();
					await closeHandle(openedHandle);
					await cleanupRepairStage(stage!);
					await release();
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
			if (opened !== null) await closeHandle(opened);
			if (stage !== null) await cleanupRepairStage(stage);
			await release();
			return unavailable(reasonForError(error));
		}
	}

	private async download(
		resolution: HistoryArchiveRepairSourceUrlResolution,
		representation: HistoryArchiveRepairObjectRepresentation
	): Promise<StagedRepairObject> {
		await prepareRepairStagingDirectory(this.stagingDirectory);
		const directory = await createRepairStageDirectory(this.stagingDirectory);
		const filePath = join(directory, 'payload');
		const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
		const transportLimit =
			representation === 'canonical-json'
				? Math.min(this.maxCompressedBytes, this.maxJsonBytes)
				: this.maxCompressedBytes;
		try {
			const response = await this.request(resolution, timeoutSignal);
			if (response.status !== 200) {
				response.body.destroy();
				throw new RemoteResponseError();
			}
			if (
				response.contentLength !== null &&
				response.contentLength > transportLimit
			) {
				response.body.destroy();
				throw new PayloadTooLargeError();
			}
			await pipeline(
				response.body,
				new ByteLimitTransform(transportLimit),
				createWriteStream(filePath, { flags: 'wx', mode: 0o600 }),
				{ signal: timeoutSignal }
			);
			return { directory, filePath };
		} catch (error) {
			await cleanupRepairStage({ directory, filePath });
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
		const value: unknown = JSON.parse(
			new TextDecoder('utf-8', { fatal: true }).decode(bytes)
		);
		assertBoundedCanonicalJson(value);
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
	if (error instanceof StagingCapacityError) {
		return 'staging-storage-unavailable';
	}
	if (
		error instanceof RemoteResponseError ||
		error instanceof RemoteHistoryArchiveResponseError
	) {
		return 'remote-response-invalid';
	}
	if (isAbortError(error)) return 'verification-timeout';
	return 'remote-fetch-failed';
}

function assertBoundedCanonicalJson(value: unknown): void {
	const pending: { readonly depth: number; readonly value: unknown }[] = [
		{ depth: 0, value }
	];
	let nodes = 0;
	while (pending.length > 0) {
		const current = pending.pop();
		if (current === undefined) break;
		nodes++;
		if (
			nodes > maxCanonicalJsonNodes ||
			current.depth > maxCanonicalJsonDepth
		) {
			throw new PayloadTooLargeError();
		}
		if (typeof current.value !== 'object' || current.value === null) continue;
		for (const child of Object.values(current.value)) {
			pending.push({ depth: current.depth + 1, value: child });
		}
	}
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

export function createRemoteHistoryArchiveRepairObjectArtifactRepository(
	workPermit: HistoryArchiveRepairArtifactWorkPermit
): RemoteHistoryArchiveRepairObjectArtifactRepository {
	return new RemoteHistoryArchiveRepairObjectArtifactRepository({
		stagingDirectory:
			process.env.HISTORY_ARCHIVE_REPAIR_STAGING_DIR ??
			join(tmpdir(), 'stellaratlas-history-archive-repair'),
		workPermit
	});
}
