import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { StrKey } from '@stellar/stellar-sdk';
import official from './fixtures/stellar-expert-directory/record.json' with { type: 'json' };
import {
	applyExpertDirectoryDelta,
	MAX_EXPERT_DELTA_BYTES,
	MAX_EXPERT_DELTA_PATHS,
	type ExpertDirectoryChange,
	type ExpertDirectoryCheckpoint,
	type ExpertDirectoryDelta,
	type ExpertDirectoryEntry,
	type ExpertDirectoryStore
} from '../ExpertDirectoryImport.js';
import {
	EXPERT_DIRECTORY_SOURCE,
	MAX_EXPERT_RECORD_BYTES,
	parseExpertDirectoryRecord
} from '../ExpertDirectoryRecord.js';

const start = 'a'.repeat(40);
const middle = official.commit;
const later = 'c'.repeat(40);
const end = 'd'.repeat(40);
const observedAt = '2026-11-04T19:00:00.000Z';
const fixtureAddress = official.path.slice(9, -5);
const contract = StrKey.encodeContract(Buffer.alloc(32, 17));
const account = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 23));
const path = (address: string) => `accounts/${address}.json`;
const gitBlob = (bytes: Uint8Array) =>
	createHash('sha1')
		.update(`blob ${bytes.byteLength}\0`)
		.update(bytes)
		.digest('hex');

const fixture = {
	kind: 'upsert',
	path: official.path,
	blobOid: official.blobOid,
	previousBlobOid: null,
	bytes: Buffer.from(official.contentBase64, 'base64')
} as const;

function upsert(
	address: string,
	fields: object = {},
	previousBlobOid: string | null = null
) {
	const bytes = Buffer.from(
		JSON.stringify({
			address,
			name: 'Example',
			tags: ['unknown-tag'],
			version: 1,
			...fields
		})
	);
	return {
		kind: 'upsert',
		path: path(address),
		previousBlobOid,
		blobOid: gitBlob(bytes),
		bytes
	} as const;
}

function delta(
	fromCommit: string,
	toCommit: string,
	...changes: readonly ExpertDirectoryChange[]
): ExpertDirectoryDelta {
	return {
		source: EXPERT_DIRECTORY_SOURCE,
		fromCommit,
		toCommit,
		observedAt,
		complete: true,
		changes
	};
}

function memoryStore() {
	let accepted = {
		checkpoint: {
			commit: start,
			observedAt,
			previousCommit: null,
			deltaSha256: null
		} as ExpertDirectoryCheckpoint,
		entries: new Map<string, ExpertDirectoryEntry>()
	};
	let interrupted = false;
	let attempts = 0;
	const store: ExpertDirectoryStore = {
		async transaction(work) {
			attempts++;
			const base = accepted;
			const entries = new Map(base.entries);
			let checkpoint = base.checkpoint;
			const result = await work({
				readCheckpoint: async () => base.checkpoint,
				readEntry: async (_source, address) => entries.get(address) ?? null,
				writeEntry: async (entry) => {
					entries.set(entry.address, entry);
				},
				advanceCheckpoint: async (_source, expectedCommit, next) => {
					if (expectedCommit !== base.checkpoint.commit)
						throw new Error('Checkpoint CAS failed');
					if (interrupted) throw new Error('Interrupted before commit');
					checkpoint = next;
				}
			});
			if (checkpoint !== base.checkpoint) {
				if (accepted !== base) throw new Error('Concurrent checkpoint update');
				accepted = { checkpoint, entries };
			}
			return result;
		}
	};
	return {
		store,
		state: () => accepted,
		attempts: () => attempts,
		interrupt: (value: boolean) => {
			interrupted = value;
		}
	};
}

const history = { isAncestor: async () => true };

test('parses one byte-exact official Git fixture and retains the matching MIT notice', () => {
	expect(official).toMatchObject({
		repository: 'stellar-expert/public-directory',
		commit: '21fda47ee3b84180598a88ce9a86e11789e6f7be',
		blobOid: '7e0f4b01ae2f4961d70cfb22222e01a543200dca'
	});
	expect(
		parseExpertDirectoryRecord(fixture.path, fixture.blobOid, fixture.bytes)
	).toMatchObject({
		source: EXPERT_DIRECTORY_SOURCE,
		publisher: 'StellarExpert',
		license: 'MIT',
		address: fixtureAddress,
		addressKind: 'account',
		networkApplicability: 'unspecified',
		name: 'SDF Escrow Jan 1 2023',
		domain: 'stellar.org',
		tags: ['custodian', 'sdf'],
		version: 1,
		sourceBlobOid: fixture.blobOid
	});
	const license = readFileSync(
		new URL('./fixtures/stellar-expert-directory/LICENSE', import.meta.url)
	);
	expect(license.toString('utf8')).toContain(
		'Copyright (c) 2022 StellarExpert'
	);
	expect(
		gitBlob(Buffer.from(license.toString('utf8').replace(/\r\n/g, '\n')))
	).toBe(official.licenseBlobOid);
});

test('only retains bounded public fields and separates G and C identities', () => {
	const record = upsert(contract, {
		name: ' Example 合約 ',
		domain: 'EXAMPLE.org.',
		tags: ['unreviewed', 'unreviewed'],
		note: 'private',
		moderator: 'private',
		apiOnly: 'private'
	});
	const parsed = parseExpertDirectoryRecord(
		record.path,
		record.blobOid,
		record.bytes
	);
	expect(parsed).toMatchObject({
		addressKind: 'contract',
		name: 'Example 合約',
		domain: 'example.org',
		tags: ['unreviewed']
	});
	for (const field of ['note', 'moderator', 'apiOnly'])
		expect(parsed).not.toHaveProperty(field);
});

test.each([
	['a bad G checksum', path('G' + 'A'.repeat(55))],
	['a bad C checksum', path('C' + 'A'.repeat(55))],
	['a path escape', '../' + official.path],
	['a nested path', 'accounts/archive/' + fixtureAddress + '.json'],
	['a trailing separator', official.path + '\n']
])('rejects %s', (_case, invalidPath) => {
	expect(() =>
		parseExpertDirectoryRecord(invalidPath, fixture.blobOid, fixture.bytes)
	).toThrow();
});

test.each([
	{ address: account },
	{ name: 'x'.repeat(161) },
	{ name: '<script>' },
	{ name: 'Left\u202Eright' },
	{ domain: 'https://example.org' },
	{ domain: '127.0.0.0x1' },
	{ version: 0 },
	{ tags: Array.from({ length: 25 }, () => 'tag') },
	{ tags: ['<script>'] }
])(
	'rejects malformed public fields and payload/path mismatches %j',
	(fields) => {
		const record = upsert(fixtureAddress, fields);
		expect(() =>
			parseExpertDirectoryRecord(record.path, record.blobOid, record.bytes)
		).toThrow();
	}
);

test('validates content binding, strict UTF-8 and record byte limits', () => {
	expect(() =>
		parseExpertDirectoryRecord(fixture.path, middle, fixture.bytes)
	).toThrow('Git identity');
	const invalid = Buffer.from([0xff]);
	expect(() =>
		parseExpertDirectoryRecord(fixture.path, gitBlob(invalid), invalid)
	).toThrow();
	const oversized = Buffer.alloc(MAX_EXPERT_RECORD_BYTES + 1, 0x20);
	expect(() =>
		parseExpertDirectoryRecord(fixture.path, gitBlob(oversized), oversized)
	).toThrow('Invalid directory blob');
});

test('atomically applies add, change and delete, then replays without changing the accepted state', async () => {
	const db = memoryStore();
	const other = upsert(contract);
	const first = await applyExpertDirectoryDelta(
		delta(start, middle, fixture, other),
		history,
		db.store
	);
	expect(first).toMatchObject({
		status: 'applied',
		checkpoint: { commit: middle, previousCommit: start }
	});
	const original = db.state();
	const replay = await applyExpertDirectoryDelta(
		{
			...delta(start, middle, other, fixture),
			observedAt: '2026-11-05T19:00:00.000Z'
		},
		history,
		db.store
	);
	expect(replay.status).toBe('replayed');
	expect(db.state()).toBe(original);
	const changed = upsert(
		fixtureAddress,
		{ name: 'Updated', version: 2 },
		fixture.blobOid
	);
	await applyExpertDirectoryDelta(
		delta(middle, later, changed, {
			kind: 'delete',
			path: other.path,
			previousBlobOid: other.blobOid
		}),
		history,
		db.store
	);
	expect(db.state().checkpoint.commit).toBe(later);
	expect(db.state().entries.get(fixtureAddress)).toMatchObject({
		state: 'active',
		name: 'Updated',
		version: 2,
		commit: later
	});
	expect(db.state().entries.get(contract)).toEqual({
		state: 'deleted',
		source: EXPERT_DIRECTORY_SOURCE,
		address: contract,
		addressKind: 'contract',
		sourcePath: other.path,
		previousBlobOid: other.blobOid,
		commit: later,
		observedAt
	});
	await applyExpertDirectoryDelta(delta(later, end, other), history, db.store);
	expect(db.state().entries.get(contract)?.state).toBe('active');
});

test('rejects duplicate paths, incomplete deltas, missing ancestry and oversized batches before writes', async () => {
	const db = memoryStore();
	await expect(
		applyExpertDirectoryDelta(
			delta(start, middle, fixture, fixture),
			history,
			db.store
		)
	).rejects.toThrow('Duplicate');
	await expect(
		applyExpertDirectoryDelta(
			{ ...delta(start, middle, fixture), complete: false },
			history,
			db.store
		)
	).rejects.toThrow('incomplete');
	await expect(
		applyExpertDirectoryDelta(
			delta(start, middle, fixture),
			{ isAncestor: async () => false },
			db.store
		)
	).rejects.toThrow('descendant');
	const excessive = Array.from(
		{ length: MAX_EXPERT_DELTA_PATHS + 1 },
		() => fixture
	);
	await expect(
		applyExpertDirectoryDelta(
			delta(start, middle, ...excessive),
			history,
			db.store
		)
	).rejects.toThrow('incomplete');
	const padded = Array.from(
		{
			length: Math.floor(MAX_EXPERT_DELTA_BYTES / MAX_EXPERT_RECORD_BYTES) + 1
		},
		(_, index) => {
			const change = upsert(
				StrKey.encodeEd25519PublicKey(Buffer.alloc(32, index + 60))
			);
			const bytes = Buffer.alloc(MAX_EXPERT_RECORD_BYTES, 0x20);
			change.bytes.copy(bytes);
			return { ...change, bytes, blobOid: gitBlob(bytes) };
		}
	);
	await expect(
		applyExpertDirectoryDelta(
			delta(start, middle, ...padded),
			history,
			db.store
		)
	).rejects.toThrow('oversized');
	expect(db.attempts()).toBe(0);
	expect(db.state().checkpoint.commit).toBe(start);
});

test('rolls back staged entries and the checkpoint on interruption, stale predecessors and divergent replays', async () => {
	const db = memoryStore();
	const original = db.state();
	db.interrupt(true);
	await expect(
		applyExpertDirectoryDelta(delta(start, middle, fixture), history, db.store)
	).rejects.toThrow('Interrupted');
	expect(db.state()).toBe(original);
	db.interrupt(false);
	await applyExpertDirectoryDelta(
		delta(start, middle, fixture),
		history,
		db.store
	);
	const accepted = db.state();
	await expect(
		applyExpertDirectoryDelta(
			delta(start, middle, upsert(account)),
			history,
			db.store
		)
	).rejects.toThrow('replay');
	await expect(
		applyExpertDirectoryDelta(
			delta(start, later, upsert(account)),
			history,
			db.store
		)
	).rejects.toThrow('delta base');
	await expect(
		applyExpertDirectoryDelta(
			delta(middle, later, upsert(contract), {
				kind: 'delete',
				path: fixture.path,
				previousBlobOid: later
			}),
			history,
			db.store
		)
	).rejects.toThrow('predecessor');
	expect(db.state()).toBe(accepted);
});

test('two writers cannot publish different successors from the same checkpoint', async () => {
	const db = memoryStore();
	const outcomes = await Promise.allSettled([
		applyExpertDirectoryDelta(delta(start, middle, fixture), history, db.store),
		applyExpertDirectoryDelta(
			delta(start, later, upsert(account)),
			history,
			db.store
		)
	]);
	expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(
		1
	);
	expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(
		1
	);
	expect(db.state().entries.size).toBe(1);
	expect([...db.state().entries.values()][0]?.commit).toBe(
		db.state().checkpoint.commit
	);
});

test('an authoritative empty path-filtered delta advances only the checkpoint', async () => {
	const db = memoryStore();
	await expect(
		applyExpertDirectoryDelta(delta(start, middle), history, db.store)
	).resolves.toMatchObject({
		status: 'applied',
		checkpoint: { commit: middle, previousCommit: start }
	});
	expect(db.state().entries.size).toBe(0);
});
