import type { DerivedOutputRecovery, DerivedOutputRetirement } from '@history-scan-coordinator/infrastructure/full-history-ledger-close-meta/FullHistoryDerivedOutputRetirement.js';
import type { Request, Response } from 'express';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open, realpath, stat, type FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

type Canonical = { path: string; byteCount: string };
type Lease = { handle: FileHandle; release(): Promise<void> };
const packagedMaterializer = fileURLToPath(new URL('../../../../bin/stellaratlas-full-history-materialize', import.meta.url));

export function checkedHistoryStorageRoot(value: string): string {
	if (!isAbsolute(value) || resolve(value) !== value || resolve(value, '..') === value ||
		!/^[A-Za-z0-9_:/\\-]+$/.test(value))
		throw new Error('History storage root must be a clean absolute directory with simple path segments');
	return value;
}
export interface HistoryColdReader {
	supports(output: DerivedOutputRetirement): boolean;
	acquire(plan: DerivedOutputRecovery, output: DerivedOutputRetirement,
		canonical: () => Promise<Canonical>): Promise<Lease>;
}

// Everything in the helper invocation comes from operator settings or registered
// descriptors, never from a public URL, a supplied executable, or request headers.
export function historyColdReader(env: NodeJS.ProcessEnv, networkPassphrase: string,
	storageRoot: string): HistoryColdReader | undefined {
	const configuredBinary = env.FULL_HISTORY_COLD_EXECUTABLE;
	const cache = env.FULL_HISTORY_COLD_CACHE_ROOT;
	const capacity = env.FULL_HISTORY_COLD_CACHE_MAX_BYTES;
	const revision = env.FULL_HISTORY_COLD_TRANSFORM_REVISION;
	if ([configuredBinary, cache, capacity, revision].every(value => value === undefined)) return undefined;
	if (configuredBinary !== packagedMaterializer || !cache || !isAbsolute(cache) || resolve(cache) !== cache ||
		!capacity || !/^[1-9]\d{0,17}$/.test(capacity) || !revision || !/^[0-9a-f]{40}$/.test(revision))
		throw new Error('Incomplete or invalid history cold-download configuration');
	const root = checkedHistoryStorageRoot(storageRoot);
	if (within(root, cache) || within(cache, root)) throw new Error('Cold cache must be separate from history storage');
	type Active = { key: string; users: number; ready: Promise<FileHandle> };
	let active: Active | undefined;
	return {
		supports: output => output.transformRevision === revision && BigInt(output.byteCount) <= BigInt(capacity) &&
			['transactions', 'transaction-results', 'operations'].includes(output.dataset),
		async acquire(plan, output, canonical) {
			const key = [plan.batchId, plan.manifestSha256, output.dataset, output.outputSha256].join(':');
			// No backlog: share one immutable FD among identical requests (each stream
			// uses an explicit offset). Native also serializes sibling API processes.
			if (active && (active.key !== key || active.users >= 16)) throw new Error('Cold download busy');
			const entry = active ??= { key, users: 0, ready: (async () => {
				const source = await canonical();
				const realRoot = await realpath(root);
				const original = await realpath(source.path);
				if (!within(realRoot, original) || original !== resolve(realRoot, source.path.slice(root.length + 1)) ||
					basename(original) !== 'ledger-close-meta.xdr.zst') throw new Error('Invalid replay source path');
				const manifest = join(dirname(original), 'manifest.json');
				const sourceStat = await stat(original, { bigint: true });
				if (!sourceStat.isFile() || sourceStat.size.toString() !== source.byteCount ||
					await realpath(manifest) !== manifest || await realpath(cache) !== cache)
					throw new Error('Unsafe cold-download input');
				return materialize(packagedMaterializer, cache, capacity, networkPassphrase, original, manifest, plan, output);
			})() };
			entry.users++;
			const release = async (): Promise<void> => {
				if (--entry.users === 0) {
					if (active === entry) active = undefined;
					await entry.ready.then(handle => handle.close(), () => {});
				}
			};
			try { return { handle: await entry.ready, release }; }
			catch (error) { await release(); throw error; }
		}
	};
}

function within(root: string, path: string): boolean {
	return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

async function materialize(binary: string, cache: string, capacity: string, passphrase: string,
	source: string, manifest: string, plan: DerivedOutputRecovery, output: DerivedOutputRetirement): Promise<FileHandle> {
	const child = spawn(binary, ['--canonical', source, '--manifest', manifest,
		'--expected-manifest-sha256', plan.manifestSha256, '--expected-source-sha256', plan.canonicalSha256,
		'--dataset', output.dataset, '--cache-root', cache, '--cache-max-bytes', capacity,
		'--network-passphrase', passphrase], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
		env: { LANG: 'C' } });
	// Only a small receipt crosses stdout; the complete Parquet never enters JS memory.
	const exited = new Promise<boolean>(done => {
		child.once('error', () => done(false));
		child.once('close', code => done(code === 0));
	});
	child.stdin.on('error', () => {});
	child.stdout.setEncoding('utf8');
	let handle: FileHandle | undefined;
	try {
		let frame = ''; let acknowledged = false;
		for await (const chunk of child.stdout) {
			if (acknowledged || frame.length + chunk.length > 8192) throw new Error('Invalid materializer receipt');
			frame += chunk;
			if (!frame.includes('\n')) continue;
			if (frame.indexOf('\n') !== frame.length - 1) throw new Error('Unexpected materializer output');
			const row = JSON.parse(frame);
			if (row?.version !== 1 || row.dataset !== output.dataset || row.sha256 !== output.outputSha256 ||
				row.byteCount !== output.byteCount || typeof row.path !== 'string' || !isAbsolute(row.path) ||
				resolve(row.path) !== row.path || !within(cache, row.path) || row.path === cache ||
				typeof row.device !== 'string' || !/^\d+$/.test(row.device) ||
				typeof row.inode !== 'string' || !/^\d+$/.test(row.inode) || await realpath(row.path) !== row.path)
				throw new Error('Cold descriptor mismatch');
			handle = await open(row.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
			const st = await handle.stat({ bigint: true });
			if (!st.isFile() || st.dev.toString() !== row.device || st.ino.toString() !== row.inode ||
				st.size.toString() !== output.byteCount) throw new Error('Cold file identity changed');
			acknowledged = true;
			child.stdin.end('opened\n');
		}
		if (!await exited || !acknowledged || !handle) throw new Error('Cold materialization failed');
		return handle;
	} catch (error) {
		child.stdin.destroy(); child.kill();
		await Promise.all([handle?.close(), exited]); throw error;
	}
}

export async function serveColdHistoryDownload(req: Request, res: Response, plan: DerivedOutputRecovery,
	output: DerivedOutputRetirement, mediaType: string, reader: HistoryColdReader, canonical: () => Promise<Canonical>) {
	return serveHistoryDescriptor(req, res, { byteCount: output.byteCount, sha256: output.outputSha256,
		filename: output.dataset + '.parquet', mediaType, reconstructed: true }, () => reader.acquire(plan, output, canonical));
}

export async function serveHistoryDescriptor(req: Request, res: Response, artifact: {
	byteCount: string; sha256: string; filename: string; mediaType: string; modified?: Date; reconstructed?: boolean;
}, acquire: () => Promise<Lease>) {
	const size = Number(artifact.byteCount);
	if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid immutable output length');
	const etag = '"sha256-' + artifact.sha256 + '"';
	res.set({ 'ETag': etag, 'Cache-Control': 'public, max-age=31536000, immutable',
		'Accept-Ranges': 'bytes', 'Content-Type': artifact.mediaType, 'X-Content-SHA256': artifact.sha256,
		'Content-Disposition': 'attachment; filename="' + artifact.filename + '"' });
	const modified = artifact.modified?.toUTCString();
	if (modified) res.setHeader('Last-Modified', modified);
	const modifiedTime = Date.parse(modified ?? '');
	const match = req.get('If-Match');
	if ((match && match.trim() !== '*' && !match.split(',').some(tag => tag.trim() === etag)) ||
		(!match && modifiedTime > Date.parse(req.get('If-Unmodified-Since') ?? '')))
		return res.status(412).end();
	const none = req.get('If-None-Match');
	if ((none && (none.trim() === '*' || none.split(',').some(tag => tag.trim().replace(/^W\//, '') === etag))) ||
		(!none && modifiedTime <= Date.parse(req.get('If-Modified-Since') ?? '')))
		return res.status(304).end();
	let start = 0; let end = size - 1; let partial = false;
	const range = req.get('Range');
	const ifRange = req.get('If-Range');
	if (range && /^bytes=/i.test(range) && (!ifRange || ifRange === etag ||
		(!ifRange.includes('"') && modifiedTime <= Date.parse(ifRange)))) {
		const parsed = req.range(size, { combine: true });
		if (parsed === -1) {
			res.setHeader('Content-Range', 'bytes */' + size);
			return res.status(416).end();
		}
		// As on the existing Express download path, ignore unsupported multipart ranges.
		if (Array.isArray(parsed) && parsed.length === 1) {
			({ start, end } = parsed[0]!); partial = true;
		}
	}
	if (partial) res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
	res.status(partial ? 206 : 200).setHeader('Content-Length', end - start + 1);
	if (req.method === 'HEAD' || size === 0) return res.end();
	const lease = await acquire();
	try {
		if (!res.destroyed) {
			if (!artifact.reconstructed) {
				// A private descriptor for this response. Unlinking its old name cannot
				// interrupt the stream or cause a reopened path to name different bytes.
				return await pipeline(lease.handle.createReadStream({ start, end }), res);
			}
			res.setHeader('X-Atlas-Artifact-Source', 'reconstructed');
			// Explicit independent positioned reads keep a disconnect from destroying a
			// different visitor's shared descriptor. No pathname is reopened after ACK.
			const buf = Buffer.allocUnsafe(Math.min(64 * 1024, end - start + 1));
			async function* bytes() {
				for (let pos = start; pos <= end;) {
					const { bytesRead } = await lease.handle.read(buf, 0, Math.min(buf.length, end - pos + 1), pos);
					if (!bytesRead) throw new Error('Cold download truncated');
					pos += bytesRead;
					yield Buffer.from(buf.subarray(0, bytesRead));
				}
			}
			await pipeline(bytes(), res);
		}
	} finally { await lease.release(); }
}
