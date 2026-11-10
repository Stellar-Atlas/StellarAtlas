import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm, rmdir, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	applyExpertDirectoryDelta,
	MAX_EXPERT_DELTA_BYTES,
	MAX_EXPERT_DELTA_PATHS,
	MAX_EXPERT_SNAPSHOT_BATCH_BYTES,
	MAX_EXPERT_SNAPSHOT_BATCH_PATHS,
	type ExpertDirectoryChange,
	type ExpertDirectoryEntry,
	type ExpertDirectoryStore
} from './ExpertDirectoryImport.js';
import {
	EXPERT_DIRECTORY_SOURCE,
	isGitOid,
	MAX_EXPERT_RECORD_BYTES,
	parseExpertDirectoryPath,
	parseExpertDirectoryRecord
} from './ExpertDirectoryRecord.js';
import {
	openDirectoryGit,
	readDirectoryFrames,
	type ReadDirectoryGit
} from './OfflineDirectoryGit.js';
import type { TypeOrmExpertDirectoryStore } from './TypeOrmExpertDirectoryStore.js';

const ZERO_OID = '0'.repeat(40);
const DIFF_OUTPUT_BYTES = MAX_EXPERT_DELTA_PATHS * 172;
const STAGING_FREE_RESERVE_BYTES = 64n * 1024n * 1024n;

export interface DirectoryGitRevision {
	readonly commit: string;
	readonly tree: string;
}

/** Validate the complete pinned tree before taking any database locks. */
export async function importLocalExpertDirectorySnapshot(
	input: {
		readonly approvedGitDir: string;
		readonly from?: DirectoryGitRevision;
		readonly to: DirectoryGitRevision;
		readonly observedAt: string;
		readonly signal?: AbortSignal;
	},
	store: Pick<TypeOrmExpertDirectoryStore, 'publishSnapshot'>
) {
	const { approvedGitDir, observedAt, signal } = input;
	const to = { ...input.to };
	const from = input.from && { ...input.from };
	const timestamp = Date.parse(observedAt);
	if (!Number.isFinite(timestamp) || observedAt.length > 64)
		throw new Error('Directory snapshot requires an exact observation time');
	const git = await openDirectoryGit(approvedGitDir, signal, 'snapshot');
	await verifyDirectoryRevisions(git, from, to);

	const temp = await mkdtemp(join(tmpdir(), 'expert-directory-snapshot-'));
	const stage = join(temp, 'entries.jsonl');
	try {
		const output = await open(stage, 'wx', 0o600);
		const digest = createHash('sha256').update('[');
		const stagedDigest = createHash('sha256');
		let count = 0;
		let payloadBytes = 0;
		const observation = { commit: to.commit, observedAt: new Date(timestamp).toISOString() };
		try {
			for await (const batch of snapshotPaths(git.listTree(to.tree))) {
				signal?.throwIfAborted();
				const { entries, bytes } = await readSnapshotBatch(git, batch, observation);
				payloadBytes += bytes;
				for (const entry of entries) {
					if (count > 0) digest.update(',');
					digest.update(JSON.stringify([entry.sourcePath, entry.sourceBlobOid, entry.contentSha256]));
					count++;
				}
				const line = JSON.stringify(entries) + '\n';
				const lineBytes = Buffer.byteLength(line);
				if (lineBytes > MAX_EXPERT_SNAPSHOT_BATCH_BYTES)
					throw new Error('Directory snapshot batch exceeds its normalized byte limit');
				const { bavail, bsize } = await statfs(temp, { bigint: true });
				if (bavail * bsize < STAGING_FREE_RESERVE_BYTES + BigInt(lineBytes))
					throw new Error('Directory snapshot staging has insufficient free space');
				await output.writeFile(line);
				stagedDigest.update(line);
			}
		} finally {
			await output.close();
		}
		signal?.throwIfAborted();
		const result = await store.publishSnapshot(
			{ ...observation, previousCommit: from?.commit ?? null, deltaSha256: digest.update(']').digest('hex') },
			readStagedSnapshot(stage, stagedDigest.digest('hex'), signal),
			signal
		);
		return { ...result, provenance: { source: EXPERT_DIRECTORY_SOURCE, ...(from && { from }), to,
			paths: count, payloadBytes } };
	} finally {
		await rm(stage, { force: true }).then(() => rmdir(temp)).catch(() => {
			console.warn('Directory staging cleanup failed');
		});
	}
}

type SnapshotPath = { readonly oid: string; readonly path: string };

async function* snapshotPaths(frames: AsyncIterable<Buffer>) {
	const decoder = new TextDecoder('utf-8', { fatal: true });
	let previous = '';
	let paths: SnapshotPath[] = [];
	for await (const frame of frames) {
		const row = decoder.decode(frame);
		const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
		if (!match || match[0] !== row)
			throw new Error('Directory snapshot tree contains a nonordinary record');
		const oid = match[2]!;
		const path = match[3]!;
		parseExpertDirectoryPath(path);
		if (path <= previous)
			throw new Error('Directory snapshot paths are duplicated or out of order');
		previous = path;
		paths.push({ oid, path });
		if (paths.length === MAX_EXPERT_SNAPSHOT_BATCH_PATHS) {
			yield paths;
			paths = [];
		}
	}
	if (paths.length) yield paths;
}

async function readSnapshotBatch(
	git: ReadDirectoryGit,
	paths: readonly SnapshotPath[],
	observation: { readonly commit: string; readonly observedAt: string }
) {
	const objects = await readObjectInfo(git, [...new Set(paths.map(({ oid }) => oid))]);
	const sizes = new Map<string, number>();
	let bytes = 0;
	for (const { oid } of paths) {
		const info = objects.get(oid)!;
		if (info.type !== 'blob' || info.size < 1 || info.size > MAX_EXPERT_RECORD_BYTES)
			throw new Error('Invalid directory snapshot blob');
		bytes += info.size;
		if (bytes > MAX_EXPERT_SNAPSHOT_BATCH_BYTES)
			throw new Error('Directory snapshot batch exceeds its raw byte limit');
		sizes.set(oid, info.size);
	}
	const payloads = await readPayloads(git, sizes, bytes);
	const entries = paths.map(({ oid, path }) => ({
		...parseExpertDirectoryRecord(path, oid, payloads.get(oid)!),
		...observation,
		state: 'active' as const
	}));
	return { entries, bytes };
}

async function* readStagedSnapshot(
	path: string,
	expectedDigest: string,
	signal?: AbortSignal
): AsyncGenerator<readonly ExpertDirectoryEntry[]> {
	const digest = createHash('sha256');
	const input = createReadStream(path, { signal });
	for await (const line of readDirectoryFrames(input, 10, MAX_EXPERT_SNAPSHOT_BATCH_BYTES - 1)) {
		digest.update(line).update('\n');
		yield JSON.parse(line.toString('utf8')) as readonly ExpertDirectoryEntry[];
	}
	if (digest.digest('hex') !== expectedDigest)
		throw new Error('Directory staging changed before publication');
}

async function verifyDirectoryRevisions(
	git: ReadDirectoryGit,
	from: DirectoryGitRevision | undefined,
	to: DirectoryGitRevision
): Promise<void> {
	const pins = from ? [from, to] : [to];
	if (pins.some(({ commit, tree }) => !isGitOid(commit) || !isGitOid(tree)) ||
		from?.commit === to.commit)
		throw new Error('Directory Git revisions require exact commit and tree IDs');
	const format = await git(['rev-parse', '--show-object-format']);
	if (lines(format.stdout, 1)[0] !== 'sha1')
		throw new Error('Directory Git object format must be SHA-1');
	const objects = await readObjectInfo(git, [...new Set(pins.flatMap(({ commit, tree }) => [commit, tree]))]);
	for (const { commit, tree } of pins) {
		if (objects.get(commit)?.type !== 'commit' || objects.get(tree)?.type !== 'tree')
			throw new Error('Directory Git revision has the wrong object type');
	}
	const resolved = await git(['rev-parse', '--revs-only', '--end-of-options',
		...pins.map(({ commit }) => commit + '^{tree}')]);
	const trees = lines(resolved.stdout, pins.length);
	if (pins.some(({ tree }, index) => tree !== trees[index]))
		throw new Error('Directory Git commit/tree binding does not match its approved tree');
	if (from && (await git(['merge-base', '--is-ancestor', from.commit, to.commit],
		{ allowExitOne: true })).exitCode !== 0)
		throw new Error('Directory Git target is not a descendant of the approved base');
}


interface PathDelta {
	readonly path: string;
	readonly previousBlobOid: string | null;
	readonly nextBlobOid: string | null;
}

/** Resolve and apply only a complete, verified delta between two approved local Git trees. */
export async function importLocalExpertDirectoryDelta(
	input: {
		readonly approvedGitDir: string;
		readonly from: DirectoryGitRevision;
		readonly to: DirectoryGitRevision;
		readonly observedAt: string;
		readonly signal?: AbortSignal;
	},
	store: ExpertDirectoryStore
) {
	const { approvedGitDir, observedAt, signal } = input;
	const from = { ...input.from };
	const to = { ...input.to };
	const git = await openDirectoryGit(approvedGitDir, signal);
	await verifyDirectoryRevisions(git, from, to);
	const diff = await git(
		[
			'diff-tree',
			'--no-commit-id',
			'--no-abbrev',
			'--raw',
			'--no-renames',
			'--no-relative',
			'--no-ext-diff',
			'--no-textconv',
			'--ignore-submodules=none',
			'--no-color',
			'-r',
			'-z',
			from.tree,
			to.tree,
			'--',
			'accounts'
		],
		{ maxBuffer: DIFF_OUTPUT_BYTES }
	);
	const paths = parsePathDelta(diff.stdout);
	const ids = new Set<string>();
	for (const path of paths) {
		if (path.previousBlobOid) ids.add(path.previousBlobOid);
		if (path.nextBlobOid) ids.add(path.nextBlobOid);
	}
	const objects = await readObjectInfo(git, [...ids]);
	for (const { type, size } of objects.values()) {
		if (type !== 'blob' || size < 1 || size > MAX_EXPERT_RECORD_BYTES)
			throw new Error('Directory Git record is not a bounded regular blob');
	}

	let payloadBytes = 0;
	const payloadSizes = new Map<string, number>();
	for (const { previousBlobOid, nextBlobOid } of paths) {
		if (!nextBlobOid || nextBlobOid === previousBlobOid) continue;
		const size = objects.get(nextBlobOid)!.size;
		payloadBytes += size;
		if (payloadBytes > MAX_EXPERT_DELTA_BYTES)
			throw new Error('Directory Git delta exceeds the aggregate blob limit');
		payloadSizes.set(nextBlobOid, size);
	}
	const payloads = await readPayloads(git, payloadSizes, payloadBytes);
	const changes: ExpertDirectoryChange[] = [];
	for (const { path, previousBlobOid, nextBlobOid } of paths) {
		if (nextBlobOid === previousBlobOid) continue; // Regular-mode-only change.
		if (nextBlobOid) {
			changes.push({
				kind: 'upsert',
				path,
				previousBlobOid,
				blobOid: nextBlobOid,
				bytes: payloads.get(nextBlobOid)!
			});
		} else {
			changes.push({ kind: 'delete', path, previousBlobOid: previousBlobOid! });
		}
	}
	signal?.throwIfAborted();
	const result = await applyExpertDirectoryDelta(
		{
			source: EXPERT_DIRECTORY_SOURCE,
			complete: true,
			observedAt,
			fromCommit: from.commit,
			toCommit: to.commit,
			changes
		},
		{
			isAncestor: async (base, target) =>
				base === from.commit && target === to.commit
		},
		store
	);
	return {
		...result,
		provenance: {
			source: EXPERT_DIRECTORY_SOURCE,
			from,
			to,
			paths: paths.length,
			payloadBytes
		}
	};
}

function parsePathDelta(output: Buffer): readonly PathDelta[] {
	if (!output.length) return [];
	const parts = new TextDecoder('utf-8', { fatal: true })
		.decode(output)
		.split('\0');
	if (
		parts.pop() !== '' ||
		parts.length % 2 ||
		parts.length / 2 > MAX_EXPERT_DELTA_PATHS
	)
		throw new Error(
			'Directory Git path enumeration is incomplete or exceeds the entry limit'
		);
	const seen = new Set<string>();
	const result: PathDelta[] = [];
	for (let i = 0; i < parts.length; i += 2) {
		const row =
			/^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([AMD])$/.exec(
				parts[i]!
			);
		const path = parts[i + 1]!;
		if (!row || row[0] !== parts[i] || seen.has(path))
			throw new Error('Invalid directory Git path delta');
		parseExpertDirectoryPath(path);
		seen.add(path);
		const [, oldMode, newMode, oldOid, newOid, status] = row;
		const previousBlobOid = readMode(oldMode!, oldOid!, status === 'A');
		const nextBlobOid = readMode(newMode!, newOid!, status === 'D');
		result.push({ path, previousBlobOid, nextBlobOid });
	}
	return result;
}

function readMode(mode: string, oid: string, absent: boolean): string | null {
	if (absent && mode === '000000' && oid === ZERO_OID) return null;
	if (!absent && (mode === '100644' || mode === '100755') && oid !== ZERO_OID)
		return oid;
	throw new Error('Directory Git path must be a regular blob');
}

async function readObjectInfo(git: ReadDirectoryGit, ids: readonly string[]) {
	const objects = new Map<string, { type: string; size: number }>();
	if (!ids.length) return objects;
	const output = await git(
		['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
		{
			input: ids.join('\n') + '\n',
			maxBuffer: Math.max(24 * 1024, ids.length * 96)
		}
	);
	const rows = lines(output.stdout, ids.length);
	for (const [index, row] of rows.entries()) {
		const info = /^([0-9a-f]{40}) ([a-z]+) ([0-9]+)$/.exec(row);
		const id = ids[index]!;
		const size = Number(info?.[3]);
		if (
			!info ||
			info[0] !== row ||
			info[1] !== id ||
			!Number.isSafeInteger(size) ||
			size < 0
		)
			throw new Error(
				'Directory Git object information is incomplete or ambiguous'
			);
		objects.set(id, { type: info[2]!, size });
	}
	return objects;
}

async function readPayloads(
	git: ReadDirectoryGit,
	sizes: ReadonlyMap<string, number>,
	payloadBytes: number
) {
	const payloads = new Map<string, Uint8Array>();
	if (!sizes.size) return payloads;
	const { stdout } = await git(['cat-file', '--batch'], {
		input: [...sizes.keys()].join('\n') + '\n',
		maxBuffer: payloadBytes + sizes.size * 64
	});
	let offset = 0;
	for (const [id, size] of sizes) {
		const header = Buffer.from(`${id} blob ${size}\n`);
		const start = offset + header.length;
		const end = start + size;
		if (!stdout.subarray(offset, start).equals(header) || stdout[end] !== 0x0a)
			throw new Error(
				'Directory Git blob response is incomplete or changed after preflight'
			);
		payloads.set(id, stdout.subarray(start, end));
		offset = end + 1;
	}
	if (offset !== stdout.length)
		throw new Error('Unexpected extra directory Git blob data');
	return payloads;
}

function lines(output: Buffer, count: number): readonly string[] {
	const parts = new TextDecoder('utf-8', { fatal: true })
		.decode(output)
		.split(/\r?\n/);
	if (parts.pop() !== '' || parts.length !== count)
		throw new Error('Directory Git metadata response is incomplete');
	return parts;
}
