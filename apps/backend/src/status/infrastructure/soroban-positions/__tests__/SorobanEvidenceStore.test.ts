import { createHash } from 'node:crypto';
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	symlink,
	unlink,
	writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
	SorobanEvidenceStore,
	SorobanEvidenceStoreBusy,
	type BlendEvidenceDocuments
} from '../SorobanEvidenceStore.js';

const digest = (bytes: Uint8Array | string) =>
	createHash('sha256').update(bytes).digest('hex');
const fixtureParent = resolve(tmpdir());
const prefix = 'soroban-evidence-';
const limits = { maxObjects: 8, maxBytes: 8192, maxObjectBytes: 1024 };
let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(fixtureParent, prefix));
});
afterEach(async () => {
	if (
		dirname(resolve(root)) !== fixtureParent ||
		!root.slice(fixtureParent.length + 1).startsWith(prefix)
	)
		throw new Error('Unexpected Soroban evidence test root');
	await rm(root, { recursive: true, force: true });
});

function document(value: object) {
	const json = JSON.stringify(value);
	return { sha256: digest(json), json };
}

function graph(
	accountId = 'synthetic A',
	withCode = true
): BlendEvidenceDocuments {
	const code = withCode
		? document({ schema: 'blend-fixed-code-v1', xdr: 'synthetic code' })
		: null;
	const shared = document({
		schema: 'blend-fixed-pool-observation-v1',
		codeRow: code ? { contentSha256: code.sha256 } : null,
		poolRows: []
	});
	const account = document({
		schema: 'blend-fixed-account-observation-v1',
		sharedSha256: shared.sha256,
		accountId,
		row: null
	});
	return { code, shared, account };
}

test('requires an existing explicit root and bounded positive limits', async () => {
	await expect(SorobanEvidenceStore.open('relative', limits)).rejects.toThrow(
		'explicit private'
	);
	await expect(
		SorobanEvidenceStore.open(join(root, 'absent'), limits)
	).rejects.toMatchObject({ code: 'ENOENT' });
	await expect(
		SorobanEvidenceStore.open(root, { ...limits, maxObjects: 0 })
	).rejects.toThrow('limits');
	await expect(
		SorobanEvidenceStore.open(root, {
			maxObjects: 1,
			maxBytes: 2_000_000,
			maxObjectBytes: 2_000_000
		})
	).rejects.toThrow('limits');
	expect(await readdir(root)).toEqual([]);
});

test('reads exact UTF-8 by digest and verifies a deduplication hit without rewriting it', async () => {
	const store = await SorobanEvidenceStore.open(root, limits);
	const record = document({ text: 'XLM 🌟' });
	expect(await store.read(record.sha256)).toBeNull();
	await store.putIfAbsent(record);
	const path = join(root, record.sha256);
	const first = await lstat(path);
	await store.putIfAbsent(record);
	expect(await store.read(record.sha256)).toEqual(record);
	expect(await readFile(path)).toEqual(Buffer.from(record.json));
	expect((await lstat(path)).ino).toBe(first.ino);
	expect(await readdir(root)).toEqual([record.sha256]);
});

test('rejects invalid paths, input digests, UTF-8, and oversize objects before publication', async () => {
	const store = await SorobanEvidenceStore.open(root, limits);
	await expect(store.read('../escape')).rejects.toThrow(
		'Invalid Soroban evidence digest'
	);
	await expect(
		store.putIfAbsent({ sha256: 'a'.repeat(64), json: 'valid UTF-8' })
	).rejects.toThrow('digest mismatch');
	const loneSurrogate = String.fromCharCode(0xd800);
	await expect(
		store.putIfAbsent({ sha256: digest(loneSurrogate), json: loneSurrogate })
	).rejects.toThrow('UTF-8');
	const large = document({ text: '🌟'.repeat(300) });
	await expect(store.putIfAbsent(large)).rejects.toThrow('object size');
	expect(await readdir(root)).toEqual([]);
});

test('refuses a corrupt existing object without overwriting or evicting it', async () => {
	const store = await SorobanEvidenceStore.open(root, limits);
	const record = document({ value: 'original' });
	const path = join(root, record.sha256);
	await writeFile(path, 'corrupt', { mode: 0o600 });
	await expect(store.read(record.sha256)).rejects.toThrow('digest mismatch');
	await expect(store.putIfAbsent(record)).rejects.toThrow('digest mismatch');
	expect(await readFile(path, 'utf8')).toBe('corrupt');
	expect(await readdir(root)).toEqual([record.sha256]);
});

test('rejects malformed UTF-8 even if its raw digest matches', async () => {
	const store = await SorobanEvidenceStore.open(root, limits);
	const invalid = Buffer.from([0xc0, 0xaf]);
	await writeFile(join(root, digest(invalid)), invalid, { mode: 0o600 });
	await expect(store.read(digest(invalid))).rejects.toThrow();
});

test('preflights object capacity for the whole graph without partial publication', async () => {
	const store = await SorobanEvidenceStore.open(root, {
		...limits,
		maxObjects: 2
	});
	await expect(store.publishBlendEvidence(graph())).rejects.toThrow(
		'object capacity'
	);
	expect(await readdir(root)).toEqual([]);
});

test('checks aggregate bytes as well as per-object size and never evicts retained data', async () => {
	const first = document({ value: 'x'.repeat(30) });
	const second = document({ value: 'y'.repeat(30) });
	const size = Buffer.byteLength(first.json);
	const store = await SorobanEvidenceStore.open(root, {
		...limits,
		maxBytes: size,
		maxObjectBytes: size
	});
	await store.putIfAbsent(first);
	await expect(store.putIfAbsent(second)).rejects.toThrow('byte capacity');
	expect(await store.read(first.sha256)).toEqual(first);
	expect(await store.read(second.sha256)).toBeNull();
});

test('retains linked code and pool once for two account references and rejects any excess', async () => {
	const store = await SorobanEvidenceStore.open(root, {
		...limits,
		maxObjects: 4
	});
	const first = graph();
	const second = graph('synthetic B');
	await store.putIfAbsent(first.code!);
	expect(await store.publishBlendEvidence(first)).toBe(first.account.sha256);
	expect(await store.publishBlendEvidence(second)).toBe(second.account.sha256);
	expect(await store.readBlendEvidence(first.account.sha256)).toEqual(first);
	expect(await store.readBlendEvidence(second.account.sha256)).toEqual(second);
	expect((await readdir(root)).sort()).toEqual(
		[
			first.code!.sha256,
			first.shared.sha256,
			first.account.sha256,
			second.account.sha256
		].sort()
	);
	await expect(
		store.publishBlendEvidence(graph('synthetic C'))
	).rejects.toThrow('object capacity');
	expect(await store.readBlendEvidence(first.account.sha256)).toEqual(first);
});

test('requires every linked dependency before reading an observation reference', async () => {
	const store = await SorobanEvidenceStore.open(root, limits);
	const records = graph();
	expect(await store.readBlendEvidence(records.account.sha256)).toBeNull();
	await store.putIfAbsent(records.account);
	expect(await store.readBlendEvidence(records.account.sha256)).toBeNull();
	await store.putIfAbsent(records.shared);
	expect(await store.readBlendEvidence(records.account.sha256)).toBeNull();
	expect(await store.publishBlendEvidence(records)).toBe(
		records.account.sha256
	);
	expect(await store.readBlendEvidence(records.account.sha256)).toEqual(
		records
	);
});

test('retains a graph with an explicit absent code link without supplying any code', async () => {
	const store = await SorobanEvidenceStore.open(root, limits);
	const records = graph('synthetic missing', false);
	expect(await store.publishBlendEvidence(records)).toBe(
		records.account.sha256
	);
	expect(await store.readBlendEvidence(records.account.sha256)).toEqual(
		records
	);
	expect(await readdir(root)).toHaveLength(2);
});

test('rejects an invalid dependency link or schema before writing any graph objects', async () => {
	const store = await SorobanEvidenceStore.open(root, limits);
	const records = graph();
	await expect(
		store.publishBlendEvidence({
			...records,
			shared: graph('other', false).shared
		})
	).rejects.toThrow('dependency digest mismatch');
	await expect(
		store.publishBlendEvidence({
			...records,
			account: document({ sharedSha256: records.shared.sha256 })
		})
	).rejects.toThrow('document schema');
	expect(await readdir(root)).toEqual([]);
});

test('rejects a corrupt dependency instead of exposing a readable graph', async () => {
	const store = await SorobanEvidenceStore.open(root, limits);
	const records = graph();
	await store.publishBlendEvidence(records);
	await writeFile(join(root, records.shared.sha256), 'corrupt');
	await expect(store.readBlendEvidence(records.account.sha256)).rejects.toThrow(
		'digest mismatch'
	);
	await expect(store.publishBlendEvidence(records)).rejects.toThrow(
		'digest mismatch'
	);
});

test('uses one no-wait writer across instances and permits retry after release', async () => {
	const a = await SorobanEvidenceStore.open(root, { ...limits, maxObjects: 1 });
	const b = await SorobanEvidenceStore.open(root, { ...limits, maxObjects: 1 });
	const object = document({ concurrent: 'same' });
	const lock = join(root, '.writer-lock');
	await writeFile(lock, '', { flag: 'wx', mode: 0o600 });
	await expect(a.putIfAbsent(object)).rejects.toBeInstanceOf(
		SorobanEvidenceStoreBusy
	);
	await expect(b.putIfAbsent(object)).rejects.toBeInstanceOf(
		SorobanEvidenceStoreBusy
	);
	await unlink(lock);
	const results = await Promise.allSettled([
		a.putIfAbsent(object),
		b.putIfAbsent(object)
	]);
	expect(
		results.filter((result) => result.status === 'fulfilled').length
	).toBeGreaterThanOrEqual(1);
	for (const result of results) {
		if (result.status === 'rejected')
			expect(result.reason).toBeInstanceOf(SorobanEvidenceStoreBusy);
	}
	await b.putIfAbsent(object);
	expect(await readdir(root)).toEqual([object.sha256]);
});

test('fails closed on unexpected or abandoned staging files', async () => {
	const store = await SorobanEvidenceStore.open(root, limits);
	const abandoned = join(root, '.incoming');
	await writeFile(abandoned, 'partial staged bytes', { mode: 0o600 });
	await expect(store.putIfAbsent(document({ value: 1 }))).rejects.toThrow(
		'Unexpected file'
	);
	expect(await readFile(abandoned, 'utf8')).toBe('partial staged bytes');
	expect(await readdir(root)).toEqual(['.incoming']);
});

test('rejects symlink roots and non-regular digest paths', async () => {
	const actual = join(root, 'actual');
	const alias = join(root, 'alias');
	await mkdir(actual, { mode: 0o700 });
	await symlink(
		actual,
		alias,
		process.platform === 'win32' ? 'junction' : 'dir'
	);
	await expect(SorobanEvidenceStore.open(alias, limits)).rejects.toThrow(
		'not a directory'
	);
	const store = await SorobanEvidenceStore.open(actual, limits);
	const object = document({ value: 'blocked' });
	await symlink(
		root,
		join(actual, object.sha256),
		process.platform === 'win32' ? 'junction' : 'dir'
	);
	await expect(store.read(object.sha256)).rejects.toThrow('not a regular file');
	await expect(store.putIfAbsent(object)).rejects.toThrow('not a regular file');
});

test('rejects a replaced root before any write', async () => {
	const nested = join(root, 'original');
	await mkdir(nested, { mode: 0o700 });
	const store = await SorobanEvidenceStore.open(nested, limits);
	await rename(nested, join(root, 'moved'));
	await mkdir(nested, { mode: 0o700 });
	await expect(store.putIfAbsent(document({ value: 1 }))).rejects.toThrow(
		'root changed'
	);
	expect(await readdir(nested)).toEqual([]);
});

const posixTest = process.platform === 'win32' ? test.skip : test;
posixTest(
	'requires private POSIX permissions for the root and retained objects',
	async () => {
		await chmod(root, 0o755);
		await expect(SorobanEvidenceStore.open(root, limits)).rejects.toThrow(
			'not private'
		);
		await chmod(root, 0o700);
		const store = await SorobanEvidenceStore.open(root, limits);
		const record = document({ private: true });
		await store.putIfAbsent(record);
		const path = join(root, record.sha256);
		expect((await lstat(path)).mode & 0o777).toBe(0o600);
		await chmod(path, 0o644);
		await expect(store.read(record.sha256)).rejects.toThrow('not private');
	}
);
