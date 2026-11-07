import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { link, lstat, open, opendir, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, join, parse, resolve } from 'node:path';
import {
	isCode,
	isRecord
} from '../http/asset-metadata/AssetMetadataValues.js';

const digestPattern = /^[0-9a-f]{64}$/;
const maxSupportedObjectBytes = 1024 * 1024;
const lockName = '.writer-lock';
const stageName = '.incoming';
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export interface SorobanEvidenceDocument {
	readonly sha256: string;
	readonly json: string;
}

export interface BlendEvidenceDocuments {
	readonly code: SorobanEvidenceDocument | null;
	readonly shared: SorobanEvidenceDocument;
	readonly account: SorobanEvidenceDocument;
}

interface EvidenceLimits {
	readonly maxBytes: number;
	readonly maxObjects: number;
	readonly maxObjectBytes: number;
}

type PreparedDocument = SorobanEvidenceDocument & { readonly bytes: Buffer };

export class SorobanEvidenceStoreBusy extends Error {
	constructor() {
		super('Soroban evidence writer is busy');
	}
}

/**
 * Explicitly opened, local private evidence storage. The owner must supply a
 * dedicated existing directory beneath trusted ancestors. On POSIX the root
 * and files must be private and owned by this process's effective UID.
 * Writers share a no-wait filesystem lock. A crashed writer may leave a lock
 * or stage that requires owner inspection. Referenced objects are never evicted.
 */
export class SorobanEvidenceStore {
	private constructor(
		private readonly root: string,
		private readonly identity: Stats,
		private readonly limits: EvidenceLimits
	) {}

	static async open(
		root: string,
		limits: EvidenceLimits
	): Promise<SorobanEvidenceStore> {
		if (!isAbsolute(root) || resolve(root) === parse(root).root)
			throw new Error(
				'An explicit private Soroban evidence directory is required'
			);
		if (
			![limits.maxBytes, limits.maxObjects, limits.maxObjectBytes].every(
				(value) => Number.isSafeInteger(value) && value > 0
			) ||
			limits.maxObjectBytes > limits.maxBytes ||
			limits.maxObjectBytes > maxSupportedObjectBytes
		)
			throw new Error('Invalid Soroban evidence store limits');

		const requested = resolve(root);
		const info = await lstat(requested);
		if (!info.isDirectory())
			throw new Error('Soroban evidence root is not a directory');
		assertPrivate(info);
		const canonical = await realpath(requested);
		const store = new SorobanEvidenceStore(canonical, info, { ...limits });
		await store.assertRoot();
		return store;
	}

	async read(sha256: string): Promise<SorobanEvidenceDocument | null> {
		return this.readDocument(sha256);
	}

	private async readDocument(
		sha256: string,
		syncExisting = false
	): Promise<SorobanEvidenceDocument | null> {
		assertDigest(sha256);
		await this.assertRoot();
		const file = join(this.root, sha256);
		let handle: Awaited<ReturnType<typeof open>>;
		try {
			handle = await open(
				file,
				constants.O_RDONLY |
					(constants.O_NOFOLLOW ?? 0) |
					(constants.O_NONBLOCK ?? 0)
			);
		} catch (error) {
			if (isCode(error, 'ENOENT')) return null;
			if (isCode(error, 'ELOOP') || isCode(error, 'EISDIR'))
				throw new Error('Soroban evidence object is not a regular file');
			throw error;
		}
		try {
			const opened = await handle.stat();
			this.assertObject(opened);
			// Authorize the opened object, not a pre-open pathname check. Also
			// reject aliases on platforms without O_NOFOLLOW before reading bytes.
			const info = await lstat(file);
			this.assertObject(info);
			if (!sameObject(info, opened))
				throw new Error('Soroban evidence object changed');
			const buffer = Buffer.alloc(opened.size + 1);
			let offset = 0;
			while (offset < buffer.length) {
				const { bytesRead } = await handle.read(
					buffer,
					offset,
					buffer.length - offset,
					offset
				);
				if (bytesRead === 0) break;
				offset += bytesRead;
			}
			if (offset !== opened.size)
				throw new Error('Soroban evidence object size changed');
			const bytes = buffer.subarray(0, offset);
			if (digest(bytes) !== sha256)
				throw new Error('Soroban evidence digest mismatch');
			const json = decoder.decode(bytes);
			if (syncExisting && process.platform !== 'win32') await handle.sync();
			await this.assertRoot();
			return { sha256, json };
		} finally {
			await handle.close();
		}
	}

	async putIfAbsent(document: SorobanEvidenceDocument): Promise<void> {
		const prepared = this.prepare(document);
		await this.withWriter(async () => this.retain([prepared]));
	}

	/**
	 * Return the account reference only after the graph is durable and can be
	 * reopened. Partial writes are immutable and safely reusable on retry.
	 */
	async publishBlendEvidence(
		documents: BlendEvidenceDocuments
	): Promise<string> {
		const code = documents.code === null ? null : this.prepare(documents.code);
		const shared = this.prepare(documents.shared);
		const account = this.prepare(documents.account);
		const sharedRef = readAccountLink(account);
		const codeRef = readSharedLink(shared);
		if (sharedRef !== shared.sha256 || codeRef !== (code?.sha256 ?? null))
			throw new Error('Soroban evidence dependency digest mismatch');
		if (code) readSchema(code, 'blend-fixed-code-v1');

		return this.withWriter(async () => {
			await this.retain(code ? [code, shared, account] : [shared, account]);
			const reopened = await this.readBlendEvidence(account.sha256);
			if (!reopened) throw new Error('Soroban evidence dependency unavailable');
			return account.sha256;
		});
	}

	/** A missing object or dependency is unavailable. Invalid bytes or links throw. */
	async readBlendEvidence(
		accountSha256: string
	): Promise<BlendEvidenceDocuments | null> {
		const account = await this.read(accountSha256);
		if (!account) return null;
		const shared = await this.read(readAccountLink(account));
		if (!shared) return null;
		const codeRef = readSharedLink(shared);
		const code = codeRef === null ? null : await this.read(codeRef);
		if (codeRef !== null && !code) return null;
		if (code) readSchema(code, 'blend-fixed-code-v1');
		return { code, shared, account };
	}

	private prepare(document: SorobanEvidenceDocument): PreparedDocument {
		const { sha256, json } = document;
		assertDigest(sha256);
		if (
			typeof json !== 'string' ||
			json.length === 0 ||
			json.length > this.limits.maxObjectBytes ||
			Buffer.byteLength(json, 'utf8') > this.limits.maxObjectBytes
		)
			throw new Error('Invalid Soroban evidence object size');
		const bytes = Buffer.from(json, 'utf8');
		if (decoder.decode(bytes) !== json)
			throw new Error('Invalid Soroban evidence UTF-8');
		if (digest(bytes) !== sha256)
			throw new Error('Soroban evidence digest mismatch');
		return { sha256, json, bytes };
	}

	private async assertRoot(): Promise<void> {
		const info = await lstat(this.root);
		if (!info.isDirectory() || !sameObject(this.identity, info))
			throw new Error('Soroban evidence root changed');
		assertPrivate(info);
	}

	private assertObject(info: Stats): void {
		if (!info.isFile())
			throw new Error('Soroban evidence object is not a regular file');
		assertPrivate(info);
		if (info.size < 1 || info.size > this.limits.maxObjectBytes)
			throw new Error('Invalid Soroban evidence object size');
	}

	private async withWriter<T>(work: () => Promise<T>): Promise<T> {
		await this.assertRoot();
		const lockPath = join(this.root, lockName);
		const lock = await open(lockPath, 'wx', 0o600).catch((error: unknown) => {
			if (isCode(error, 'EEXIST')) throw new SorobanEvidenceStoreBusy();
			throw error;
		});
		try {
			await this.assertRoot();
			return await work();
		} finally {
			await lock.close();
			await this.assertRoot();
			await unlink(lockPath);
		}
	}

	private async retain(documents: readonly PreparedDocument[]): Promise<void> {
		const usage = await this.inventory();
		const missing: PreparedDocument[] = [];
		for (const document of documents) {
			const retained = await this.readDocument(document.sha256, true);
			if (retained) {
				if (retained.json !== document.json)
					throw new Error('Existing Soroban evidence bytes differ');
			} else {
				usage.objects++;
				if (document.bytes.length > this.limits.maxBytes - usage.bytes)
					throw new Error('Soroban evidence store byte capacity exhausted');
				usage.bytes += document.bytes.length;
				missing.push(document);
			}
		}
		if (usage.objects > this.limits.maxObjects)
			throw new Error('Soroban evidence store object capacity exhausted');

		// Sync existing directory entries as well, including a prior interrupted publication.
		await this.syncRoot();
		for (const document of missing) await this.publishOne(document);
		for (const document of documents) {
			const retained = await this.read(document.sha256);
			if (retained?.json !== document.json)
				throw new Error('Soroban evidence publication could not be verified');
		}
	}

	private async inventory(): Promise<{ objects: number; bytes: number }> {
		const usage = { objects: 0, bytes: 0 };
		for await (const item of await opendir(this.root)) {
			if (item.name === lockName) continue;
			if (!digestPattern.test(item.name))
				throw new Error('Unexpected file in private Soroban evidence root');
			const info = await lstat(join(this.root, item.name));
			this.assertObject(info);
			if (++usage.objects > this.limits.maxObjects)
				throw new Error('Soroban evidence store object capacity exhausted');
			if (info.size > this.limits.maxBytes - usage.bytes)
				throw new Error('Soroban evidence store byte capacity exhausted');
			usage.bytes += info.size;
		}
		return usage;
	}

	private async publishOne(document: PreparedDocument): Promise<void> {
		const stage = join(this.root, stageName);
		await this.assertRoot();
		const handle = await open(stage, 'wx', 0o600);
		try {
			try {
				await handle.writeFile(document.bytes);
				await handle.sync();
			} finally {
				await handle.close();
			}
			await this.assertRoot();
			try {
				await link(stage, join(this.root, document.sha256));
			} catch (error) {
				if (!isCode(error, 'EEXIST')) throw error;
				const existing = await this.read(document.sha256);
				if (existing?.json !== document.json)
					throw new Error('Existing Soroban evidence bytes differ');
			}
		} finally {
			await this.assertRoot();
			await unlink(stage);
		}
		await this.syncRoot();
	}

	private async syncRoot(): Promise<void> {
		await this.assertRoot();
		// Windows fixtures exercise no-clobber and integrity. Directory fsync is POSIX.
		if (process.platform === 'win32') return;
		const handle = await open(
			this.root,
			constants.O_RDONLY |
				(constants.O_DIRECTORY ?? 0) |
				(constants.O_NOFOLLOW ?? 0)
		);
		try {
			const info = await handle.stat();
			if (!info.isDirectory() || !sameObject(this.identity, info))
				throw new Error('Soroban evidence root changed');
			await handle.sync();
		} finally {
			await handle.close();
		}
	}
}

function assertPrivate(info: Stats): void {
	if (
		process.platform !== 'win32' &&
		((info.mode & 0o077) !== 0 || info.uid !== process.geteuid?.())
	)
		throw new Error(
			'Soroban evidence path is not private and owner-controlled'
		);
}

function sameObject(first: Stats, second: Stats): boolean {
	return first.dev === second.dev && first.ino === second.ino;
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function assertDigest(value: unknown): asserts value is string {
	if (typeof value !== 'string' || !digestPattern.test(value))
		throw new Error('Invalid Soroban evidence digest');
}

function readSchema(
	document: SorobanEvidenceDocument,
	schema: string
): Record<string, unknown> {
	const value: unknown = JSON.parse(document.json);
	if (!isRecord(value) || value.schema !== schema)
		throw new Error('Invalid Soroban evidence document schema');
	return value;
}

function readAccountLink(account: SorobanEvidenceDocument): string {
	const { sharedSha256 } = readSchema(
		account,
		'blend-fixed-account-observation-v1'
	);
	assertDigest(sharedSha256);
	return sharedSha256;
}

function readSharedLink(shared: SorobanEvidenceDocument): string | null {
	const { codeRow } = readSchema(shared, 'blend-fixed-pool-observation-v1');
	if (codeRow === null) return null;
	if (!isRecord(codeRow)) throw new Error('Invalid Soroban evidence code link');
	const { contentSha256 } = codeRow;
	assertDigest(contentSha256);
	return contentSha256;
}
