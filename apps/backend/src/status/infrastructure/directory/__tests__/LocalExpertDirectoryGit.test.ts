import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StrKey } from '@stellar/stellar-sdk';
import {
	MAX_EXPERT_DELTA_PATHS,
	type ExpertDirectoryCheckpoint,
	type ExpertDirectoryEntry,
	type ExpertDirectoryStore
} from '../ExpertDirectoryImport.js';
import { MAX_EXPERT_RECORD_BYTES } from '../ExpertDirectoryRecord.js';
import {
	importLocalExpertDirectoryDelta,
	importLocalExpertDirectorySnapshot,
	type DirectoryGitRevision
} from '../LocalExpertDirectoryGit.js';

const observedAt = '2026-11-04T20:00:00.000Z';
const account = (seed: number) =>
	StrKey.encodeEd25519PublicKey(Buffer.alloc(32, seed));
const accountA = account(7);
const accountB = account(8);
const filename = (address: string) => address + '.json';
jest.setTimeout(30_000);
let root: string;
let base: DirectoryGitRevision;

const env = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))
);
Object.assign(env, {
	GIT_CONFIG_NOSYSTEM: '1',
	GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
	GIT_AUTHOR_NAME: 'Local test',
	GIT_AUTHOR_EMAIL: 'local@example.invalid',
	GIT_COMMITTER_NAME: 'Local test',
	GIT_COMMITTER_EMAIL: 'local@example.invalid'
});

function git(args: readonly string[], input?: string | Uint8Array): string {
	return execFileSync('git', ['--git-dir=' + root, ...args], {
		env,
		input,
		encoding: 'utf8',
		windowsHide: true
	}).trim();
}

function blob(address: string, name = 'Fixture issuer'): string {
	return git(
		['hash-object', '-w', '--stdin'],
		JSON.stringify({ address, name, tags: ['fixture'], version: 1 }, null, 2)
	);
}

function row(
	address: string,
	oid: string,
	mode = '100644',
	type = 'blob'
): string {
	return `${mode} ${type} ${oid}\t${filename(address)}\n`;
}

function revision(
	rows: readonly string[],
	parent?: DirectoryGitRevision,
	notes?: string
): DirectoryGitRevision {
	const accounts = git(['mktree', '--missing'], rows.join(''));
	const tree = git(
		['mktree'],
		`040000 tree ${accounts}\taccounts\n` +
			(notes ? `100644 blob ${notes}\tnotes.txt\n` : '')
	);
	const commit = git(
		['commit-tree', tree, ...(parent ? ['-p', parent.commit] : [])],
		'Local synthetic fixture\n'
	);
	return { commit, tree };
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'expert-directory-git-'));
	execFileSync(
		'git',
		['init', '--quiet', '--bare', '--object-format=sha1', '--template=', root],
		{ env, windowsHide: true }
	);
	base = revision([]);
});

it('validates the complete pinned initial snapshot before one atomic store admission', async () => {
	const to = revision([row(accountA, blob(accountA)), row(accountB, blob(accountB))]);
	const initializeSnapshot = jest.fn(async (checkpoint: ExpertDirectoryCheckpoint,
		entries: readonly ExpertDirectoryEntry[]) => {
		expect(entries.map((entry) => entry.address)).toEqual([accountA, accountB].sort());
		expect(entries.every((entry) => entry.state === 'active' &&
			entry.commit === to.commit && entry.source === 'stellar-expert/public-directory')).toBe(true);
		return { status: 'initialized' as const, checkpoint };
	});
	const result = await importLocalExpertDirectorySnapshot({
		approvedGitDir: root, to, observedAt
	}, { initializeSnapshot });
	expect(result.status).toBe('initialized');
	expect(result.provenance.paths).toBe(2);
	expect(result.checkpoint).toMatchObject({ commit: to.commit, previousCommit: null });
	expect(result.checkpoint.deltaSha256).toMatch(/^[a-f0-9]{64}$/);
	expect(initializeSnapshot).toHaveBeenCalledTimes(1);
	await expect(importLocalExpertDirectorySnapshot({
		approvedGitDir: root, to: { ...to, tree: base.tree }, observedAt
	}, { initializeSnapshot })).rejects.toThrow('binding');
	expect(initializeSnapshot).toHaveBeenCalledTimes(1);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function fixtureStore() {
	let checkpoint: ExpertDirectoryCheckpoint = {
		commit: base.commit,
		observedAt,
		previousCommit: null,
		deltaSha256: null
	};
	let entries = new Map<string, ExpertDirectoryEntry>();
	let transactions = 0;
	const store: ExpertDirectoryStore = {
		async transaction(work) {
			transactions++;
			const staged = new Map(entries);
			let next = checkpoint;
			const value = await work({
				readCheckpoint: async () => checkpoint,
				readEntry: async (_source, address) => staged.get(address) ?? null,
				writeEntry: async (entry) => {
					staged.set(entry.address, entry);
				},
				advanceCheckpoint: async (_source, expected, proposed) => {
					if (checkpoint.commit !== expected)
						throw new Error('stale fixture checkpoint');
					next = proposed;
				}
			});
			if (next !== checkpoint) {
				checkpoint = next;
				entries = staged;
			}
			return value;
		}
	};
	return {
		store,
		checkpoint: () => checkpoint,
		entries: () => entries,
		transactions: () => transactions
	};
}

function apply(
	db: ReturnType<typeof fixtureStore>,
	from: DirectoryGitRevision,
	to: DirectoryGitRevision,
	signal?: AbortSignal
) {
	return importLocalExpertDirectoryDelta(
		{ approvedGitDir: root, from, to, observedAt, signal },
		db.store
	);
}

test('reads only account paths, binds exact revisions and applies add, change, delete and replay', async () => {
	const db = fixtureStore();
	const firstOid = blob(accountA);
	const otherOid = blob(accountB);
	const notes = git(
		['hash-object', '-w', '--stdin'],
		'Unrelated local content'
	);
	const first = revision(
		[row(accountA, firstOid), row(accountB, otherOid)],
		base,
		notes
	);
	const added = await apply(db, base, first);
	expect(added).toMatchObject({
		status: 'applied',
		checkpoint: { commit: first.commit },
		provenance: {
			source: 'stellar-expert/public-directory',
			from: base,
			to: first,
			paths: 2
		}
	});
	expect(db.entries().get(accountA)).toMatchObject({
		sourceBlobOid: firstOid,
		sourcePath: 'accounts/' + filename(accountA)
	});
	const acceptedEntries = db.entries();
	expect((await apply(db, base, first)).status).toBe('replayed');
	expect(db.entries()).toBe(acceptedEntries);

	const secondOid = blob(accountA, 'Changed issuer');
	const second = revision([row(accountA, secondOid)], first);
	await expect(apply(db, first, second)).resolves.toMatchObject({
		status: 'applied',
		provenance: { paths: 2 }
	});
	expect(db.entries().get(accountA)).toMatchObject({
		sourceBlobOid: secondOid,
		name: 'Changed issuer',
		commit: second.commit
	});
	expect(db.entries().get(accountB)).toMatchObject({
		state: 'deleted',
		previousBlobOid: otherOid,
		commit: second.commit
	});
	expect(db.checkpoint().commit).toBe(second.commit);
});

test('even a Git-detectable rename is an exact delete and add', async () => {
	const db = fixtureStore();
	const name = 'Similar publisher text '.repeat(6);
	const firstOid = blob(accountA, name);
	const first = revision([row(accountA, firstOid)], base);
	await apply(db, base, first);
	const nextOid = blob(accountB, name);
	const next = revision([row(accountB, nextOid)], first);
	expect(
		git([
			'diff-tree',
			'-r',
			'-M',
			'--no-commit-id',
			'--name-status',
			first.tree,
			next.tree
		])
	).toMatch(/^R\d+/);
	expect((await apply(db, first, next)).provenance.paths).toBe(2);
	expect(db.entries().get(accountA)).toMatchObject({
		state: 'deleted',
		previousBlobOid: firstOid
	});
	expect(db.entries().get(accountB)).toMatchObject({
		state: 'active',
		sourceBlobOid: nextOid
	});
});

test('a regular mode-only change advances the checkpoint without replacing the record', async () => {
	const db = fixtureStore();
	const oid = blob(accountA);
	const first = revision([row(accountA, oid)], base);
	await apply(db, base, first);
	const entry = db.entries().get(accountA);
	const next = revision([row(accountA, oid, '100755')], first);
	expect((await apply(db, first, next)).provenance).toMatchObject({
		paths: 1,
		payloadBytes: 0
	});
	expect(db.entries().get(accountA)).toBe(entry);
	expect(db.checkpoint().commit).toBe(next.commit);
});

test('rejects ambiguous, incorrect and unrelated revision evidence before store admission', async () => {
	const db = fixtureStore();
	const next = revision([row(accountA, blob(accountA))], base);
	await expect(apply(db, base, { ...next, commit: 'HEAD' })).rejects.toThrow(
		'exact commit and tree IDs'
	);
	await expect(apply(db, base, { ...next, tree: base.tree })).rejects.toThrow(
		'approved tree'
	);
	await expect(
		apply(db, base, { commit: next.tree, tree: next.tree })
	).rejects.toThrow('object type');
	const unrelated = revision([row(accountB, blob(accountB))]);
	await expect(apply(db, base, unrelated)).rejects.toThrow('not a descendant');
	git(['update-ref', 'refs/heads/' + next.commit, base.commit]);
	await expect(apply(db, base, next)).rejects.toThrow('incomplete');
	expect(db.transactions()).toBe(0);
});

test('rejects invalid modes, missing blobs, binary input, oversize and mismatched paths without writes', async () => {
	const db = fixtureStore();
	const valid = blob(accountA);
	const binary = git(
		['hash-object', '-w', '--stdin'],
		Buffer.from([0xff, 0, 1])
	);
	const large = git(
		['hash-object', '-w', '--stdin'],
		Buffer.alloc(MAX_EXPERT_RECORD_BYTES + 1, 0x20)
	);
	for (const [entry, error] of [
		[row(accountA, valid, '120000'), 'regular blob'],
		[row(accountA, base.commit, '160000', 'commit'), 'regular blob'],
		[row(accountA, 'f'.repeat(40)), 'object information is incomplete'],
		[row(accountA, binary), 'encoded data'],
		[row(accountA, large), 'bounded regular blob'],
		[row(accountB, valid), 'does not match its path']
	] as const) {
		await expect(apply(db, base, revision([entry], base))).rejects.toThrow(
			error
		);
	}
	expect(db.transactions()).toBe(0);
	expect(db.checkpoint().commit).toBe(base.commit);
});

test('rejects excess aggregate bytes, too many paths and interrupted output enumeration', async () => {
	const db = fixtureStore();
	const padded = Buffer.alloc(MAX_EXPERT_RECORD_BYTES, 0x20);
	padded.write(
		JSON.stringify({ address: accountA, name: 'Fixture', tags: [], version: 1 })
	);
	const paddedOid = git(['hash-object', '-w', '--stdin'], padded);
	const rows = (count: number, oid: string) =>
		Array.from({ length: count }, (_, i) => row(account(i + 20), oid));
	await expect(
		apply(db, base, revision(rows(65, paddedOid), base))
	).rejects.toThrow('aggregate blob limit');
	const oid = blob(accountA);
	await expect(
		apply(db, base, revision(rows(MAX_EXPERT_DELTA_PATHS + 1, oid), base))
	).rejects.toThrow('entry limit');
	await expect(apply(db, base, revision(rows(150, oid), base))).rejects.toThrow(
		'diff-tree read failed or was incomplete'
	);
	expect(db.transactions()).toBe(0);
	expect(db.checkpoint().commit).toBe(base.commit);
});

test('rejects an aborted request before admitting any store transaction', async () => {
	const db = fixtureStore();
	const next = revision([row(accountA, blob(accountA))], base);
	const controller = new AbortController();
	controller.abort(new Error('Fixture interrupted'));
	await expect(apply(db, base, next, controller.signal)).rejects.toThrow(
		'Fixture interrupted'
	);
	expect(db.transactions()).toBe(0);
});

test('a regular-mode path that refers to a non-blob object fails object preflight', async () => {
	const db = fixtureStore();
	const raw = Buffer.concat([
		Buffer.from('100644 ' + filename(accountA) + '\0'),
		Buffer.from(base.tree, 'hex')
	]);
	const accountsTree = git(
		['hash-object', '--literally', '-w', '-t', 'tree', '--stdin'],
		raw
	);
	const tree = git(['mktree'], `040000 tree ${accountsTree}\taccounts\n`);
	const commit = git(
		['commit-tree', tree, '-p', base.commit],
		'Malformed local fixture\n'
	);
	await expect(apply(db, base, { tree, commit })).rejects.toThrow(
		'bounded regular blob'
	);
	expect(db.transactions()).toBe(0);
});
