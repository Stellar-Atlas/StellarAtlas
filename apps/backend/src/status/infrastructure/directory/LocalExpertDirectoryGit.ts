import {
	applyExpertDirectoryDelta,
	MAX_EXPERT_DELTA_BYTES,
	MAX_EXPERT_DELTA_PATHS,
	type ExpertDirectoryChange,
	type ExpertDirectoryStore
} from './ExpertDirectoryImport.js';
import {
	EXPERT_DIRECTORY_SOURCE,
	isGitOid,
	MAX_EXPERT_RECORD_BYTES,
	parseExpertDirectoryPath
} from './ExpertDirectoryRecord.js';
import {
	openDirectoryGit,
	type ReadDirectoryGit
} from './OfflineDirectoryGit.js';

const ZERO_OID = '0'.repeat(40);
const DIFF_OUTPUT_BYTES = MAX_EXPERT_DELTA_PATHS * 172;

export interface DirectoryGitRevision {
	readonly commit: string;
	readonly tree: string;
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
	if (
		![from.commit, from.tree, to.commit, to.tree].every(isGitOid) ||
		from.commit === to.commit
	)
		throw new Error(
			'Directory Git revisions require exact commit and tree IDs'
		);

	const git = await openDirectoryGit(approvedGitDir, signal);
	const format = await git(['rev-parse', '--show-object-format']);
	if (lines(format.stdout, 1)[0] !== 'sha1')
		throw new Error('Directory Git object format must be SHA-1');
	const revisions = await readObjectInfo(git, [
		...new Set([from.commit, to.commit, from.tree, to.tree])
	]);
	for (const revision of [from, to]) {
		if (
			revisions.get(revision.commit)?.type !== 'commit' ||
			revisions.get(revision.tree)?.type !== 'tree'
		)
			throw new Error('Directory Git revision has the wrong object type');
	}
	const resolved = await git([
		'rev-parse',
		'--revs-only',
		'--end-of-options',
		from.commit + '^{tree}',
		to.commit + '^{tree}'
	]);
	const trees = lines(resolved.stdout, 2);
	if (trees[0] !== from.tree || trees[1] !== to.tree)
		throw new Error('Directory Git commit does not match its approved tree');

	const ancestry = await git(
		['merge-base', '--is-ancestor', from.commit, to.commit],
		{ allowExitOne: true }
	);
	if (ancestry.exitCode !== 0)
		throw new Error(
			'Directory Git target is not a descendant of the approved base'
		);
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
			input: ids.join('\n') + '\n'
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
