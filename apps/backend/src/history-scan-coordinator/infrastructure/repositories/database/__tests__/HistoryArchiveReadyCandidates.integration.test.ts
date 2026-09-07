import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { historyArchiveSequentialPrefetchLedgerSpan } from '../HistoryArchiveSequentialChainSql.js';
import { historyArchiveReadyCohortCandidatesSql } from '../HistoryArchiveReadyCandidatesSql.js';
import {
	historyArchiveSchedulableObjectSql,
	refillReadyObjectsSql
} from '../HistoryArchiveObjectReadyQueue.js';

jest.setTimeout(45_000);
const root = 'https://archive.example/history';
const first = 127;
const last = first + historyArchiveSequentialPrefetchLedgerSpan;
const past = '2000-01-01T00:00:00Z';
const future = '2999-01-01T00:00:00Z';
type Fixture = {
	archiveUrlIdentity: string;
	bucketHash: string | null;
	checkpointLedger: number | null;
	dependencyReady: boolean | null;
	executionDisposition: string | null;
	executionReason: string | null;
	hostIdentity: string;
	lastClaimedAt: string | null;
	nextAttemptAt: string | null;
	objectKey: string;
	objectOrder: number;
	objectType: string;
	remoteId: string;
	status: string;
	transitionEffectsRequiredAt: string | null;
	transitionEffectsCompletedAt: string | null;
};

describe('cursor-keyed ready candidates', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await new DataSource({
			type: 'postgres',
			url: postgres.url
		}).initialize();
		await db.query(schemaSql);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	beforeEach(async () => {
		await db.query(`truncate history_archive_object_queue,
			history_archive_checkpoint_scan_cursor,
			history_archive_checkpoint_bucket_dependency,
			history_archive_checkpoint_content_observation,
			history_archive_checkpoint_content,
			history_archive_checkpoint_bucket_set_member,
			history_archive_object_ready, history_archive_object_host_throttle,
			history_archive_state_snapshot, full_history_promotion_runtime
			restart identity`);
	});

	async function seed(
		overrides: readonly Partial<Fixture>[]
	): Promise<Fixture[]> {
		const objects = overrides.map((override) => ({
			archiveUrlIdentity: root,
			bucketHash: null,
			checkpointLedger: first,
			dependencyReady: true,
			executionDisposition: 'executable',
			executionReason: null,
			hostIdentity: 'archive.example',
			lastClaimedAt: null,
			nextAttemptAt: null,
			objectKey: randomUUID(),
			objectOrder: 20,
			objectType: 'ledger',
			remoteId: randomUUID(),
			status: 'pending',
			transitionEffectsRequiredAt: null,
			transitionEffectsCompletedAt: null,
			...override
		}));
		await db.query(
			`insert into history_archive_object_queue (
			"archiveUrlIdentity", "bucketHash", "checkpointLedger", "dependencyReady",
			"executionDisposition", "executionReason", "hostIdentity", "lastClaimedAt",
			"nextAttemptAt", "objectKey", "objectOrder", "objectType", "remoteId",
			status, "transitionEffectsRequiredAt", "transitionEffectsCompletedAt"
		) select * from jsonb_to_recordset($1::jsonb) as value(
			"archiveUrlIdentity" text, "bucketHash" text, "checkpointLedger" integer,
			"dependencyReady" boolean, "executionDisposition" text, "executionReason" text,
			"hostIdentity" text, "lastClaimedAt" timestamptz, "nextAttemptAt" timestamptz,
			"objectKey" text, "objectOrder" integer, "objectType" text, "remoteId" uuid,
			status text, "transitionEffectsRequiredAt" timestamptz,
			"transitionEffectsCompletedAt" timestamptz
		)`,
			[JSON.stringify(objects)]
		);
		return objects;
	}
	async function cursor(identity = root, next: number | null = first + 64) {
		await db.query(
			`insert into history_archive_checkpoint_scan_cursor values ($1, $2)`,
			[identity, next]
		);
	}
	async function legacy(checkpoint: number, hash: string, identity = root) {
		await db.query(
			`insert into history_archive_checkpoint_bucket_dependency
			("archiveUrlIdentity", "checkpointLedger", "bucketHash") values ($1, $2, $3)`,
			[identity, checkpoint, hash]
		);
	}
	async function shared(checkpoint: number, hashes: readonly string[]) {
		const digest = randomUUID();
		await db.query(
			`insert into history_archive_checkpoint_content values ($1, $1)`,
			[digest]
		);
		await db.query(
			`insert into history_archive_checkpoint_content_observation
			("archiveUrlIdentity", "checkpointLedger", "contentDigest", "checkpointStateObjectRemoteId")
			values ($1, $2, $3, $4)`,
			[root, checkpoint, digest, randomUUID()]
		);
		for (const hash of hashes) {
			await db.query(
				`insert into history_archive_checkpoint_bucket_set_member values ($1, $2)`,
				[digest, hash]
			);
		}
	}
	async function candidates(identity = root): Promise<string[]> {
		const oldRows: { remoteId: string }[] = await db.query(
			`
			select candidate."remoteId" from history_archive_object_queue candidate
			where candidate."archiveUrlIdentity" = $1 and
				${historyArchiveSchedulableObjectSql('candidate')}
			order by candidate."remoteId"`,
			[identity]
		);
		const newRows: { remoteId: string }[] = await db.query(
			`
			select candidate."remoteId" from (
				${historyArchiveReadyCohortCandidatesSql('$1::text')}
			) candidate order by candidate."remoteId"`,
			[identity]
		);
		expect(newRows).toEqual(oldRows);
		expect(new Set(newRows.map((row) => row.remoteId)).size).toBe(
			newRows.length
		);
		return newRows.map((row) => row.remoteId);
	}
	it('preserves null-checkpoint objects, including buckets, without any cursor', async () => {
		const objects = await seed([
			{
				checkpointLedger: null,
				objectType: 'history-archive-state',
				objectKey: 'root'
			},
			{
				checkpointLedger: null,
				objectType: 'bucket',
				bucketHash: 'null-bucket'
			},
			{ checkpointLedger: first },
			{ checkpointLedger: null, status: 'verified' }
		]);
		expect(await candidates()).toEqual(
			objects
				.slice(0, 2)
				.map((row) => row.remoteId)
				.sort()
		);
		await cursor(root, null);
		expect(await candidates()).toHaveLength(2);
	});
	it('keeps inclusive range boundaries and every mutable eligibility condition', async () => {
		await cursor();
		const objects = await seed([
			{ checkpointLedger: first - 64 },
			{ checkpointLedger: first },
			{ checkpointLedger: last },
			{ checkpointLedger: last + 64 },
			{ status: 'failed', nextAttemptAt: past },
			{ status: 'failed', nextAttemptAt: future },
			{ status: 'failed', nextAttemptAt: null },
			{ nextAttemptAt: future },
			{ dependencyReady: false },
			{ dependencyReady: null },
			{ executionDisposition: 'deferred' },
			{ executionDisposition: null },
			{ status: 'scanning' },
			{ status: 'verified' },
			{ transitionEffectsRequiredAt: past },
			{ transitionEffectsRequiredAt: past, transitionEffectsCompletedAt: past },
			{ checkpointLedger: last, objectType: 'scp' }
		]);
		expect(await candidates()).toEqual(
			[1, 2, 4, 7, 15, 16].map((index) => objects[index]!.remoteId).sort()
		);
	});
	it('deduplicates shared/legacy membership and admits reused old-checkpoint buckets', async () => {
		await cursor();
		await shared(first, ['shared', 'reused']);
		await legacy(first, 'suppressed');
		await legacy(first + 64, 'legacy');
		await legacy(first + 64, 'reused');
		await legacy(last + 64, 'future');
		const objects = await seed(
			['shared', 'reused', 'legacy', 'suppressed', 'future', 'orphan'].map(
				(hash) => ({
					objectType: 'bucket',
					bucketHash: hash,
					checkpointLedger: 63
				})
			)
		);
		expect(await candidates()).toEqual(
			objects
				.slice(0, 3)
				.map((row) => row.remoteId)
				.sort()
		);
	});
	it('lets an observed empty shared set suppress legacy fallback only at that checkpoint', async () => {
		await cursor();
		await shared(first, []);
		await legacy(first, 'suppressed');
		await legacy(first + 64, 'legacy');
		const objects = await seed([
			{ objectType: 'bucket', bucketHash: 'suppressed' },
			{
				objectType: 'bucket',
				bucketHash: 'legacy',
				checkpointLedger: last + 64
			},
			{ objectType: 'bucket', bucketHash: 'suppressed', checkpointLedger: null }
		]);
		expect(await candidates()).toEqual(
			objects
				.slice(1)
				.map((row) => row.remoteId)
				.sort()
		);
	});
	it('does not mix source identities or admit unready and deferred bucket members', async () => {
		await cursor();
		await legacy(first, 'same-hash');
		const objects = await seed([
			{ objectType: 'bucket', bucketHash: 'same-hash' },
			{ objectType: 'bucket', bucketHash: 'same-hash', dependencyReady: false },
			{
				objectType: 'bucket',
				bucketHash: 'same-hash',
				executionDisposition: 'deferred'
			},
			{
				objectType: 'bucket',
				bucketHash: 'same-hash',
				archiveUrlIdentity: 'other'
			}
		]);
		expect(await candidates()).toEqual([objects[0]!.remoteId]);
		expect(await candidates('other')).toEqual([]);
	});
	it('keeps refill priorities, per-root limits, host throttle and published rows unchanged', async () => {
		await cursor();
		await cursor('other');
		await cursor('blocked');
		await db.query(
			`with state as (
				insert into history_archive_state_snapshot values ($1, 'available', 'fixture network')
			)
			insert into full_history_promotion_runtime values
				(sha256(convert_to('fixture network', 'UTF8')), 'waiting-for-proof', 127, null, null)`,
			[root]
		);
		await seed(
			[root, 'other', 'blocked'].map((identity, index) => ({
				archiveUrlIdentity: identity,
				hostIdentity: identity,
				objectType: 'history-archive-state',
				objectKey: 'root',
				checkpointLedger: null,
				status: 'verified',
				lastClaimedAt: index === 0 ? null : past
			}))
		);
		const objects = await seed([
			{
				objectType: 'checkpoint-state',
				objectKey: 'checkpoint-state:0000007f',
				executionReason: 'canonical-frontier-reserve'
			},
			{ executionReason: 'proof-completion-reserve' },
			{ objectOrder: 10, checkpointLedger: last },
			{ nextAttemptAt: future },
			{
				archiveUrlIdentity: 'other',
				executionReason: 'proof-completion-reserve'
			},
			{
				archiveUrlIdentity: 'blocked',
				executionReason: 'proof-completion-reserve'
			}
		]);
		await db.query(
			`insert into history_archive_object_host_throttle values ('blocked', $1)`,
			[future]
		);
		const published = objects[0]!;
		await db.query(
			`insert into history_archive_object_ready
			("objectRemoteId", "archiveUrlIdentity", priority, "availableAt", "dispatchToken", "publishedAt")
			values ($1, $2, 2, $3, $4, $3)`,
			[published.remoteId, root, past, randomUUID()]
		);
		const candidateSql = historyArchiveReadyCohortCandidatesSql(
			'root."archiveUrlIdentity"'
		);
		const referenceSql = refillReadyObjectsSql.replace(
			candidateSql,
			`
			select candidate.* from history_archive_object_queue candidate
			where candidate."archiveUrlIdentity" = root."archiveUrlIdentity"
				and ${historyArchiveSchedulableObjectSql('candidate')}`
		);
		expect(referenceSql).not.toBe(refillReadyObjectsSql);
		for (const limit of [1, 2, 4, 20]) {
			await db.transaction(async (manager) => {
				await manager.query('savepoint reference_refill');
				const oldCount = await manager.query(referenceSql, [limit]);
				const oldRows = await manager.query(readyRowsSql);
				await manager.query('rollback to savepoint reference_refill');
				const newCount = await manager.query(refillReadyObjectsSql, [limit]);
				expect(newCount).toEqual(oldCount);
				expect(await manager.query(readyRowsSql)).toEqual(oldRows);
				await manager.query('rollback to savepoint reference_refill');
			});
		}
		await db.query(refillReadyObjectsSql, [20]);
		expect(
			await db.query(
				`select priority from history_archive_object_ready where "objectRemoteId"=$1`,
				[published.remoteId]
			)
		).toEqual([{ priority: 2 }]);
		expect(
			await db.query(
				`select 1 from history_archive_object_ready where "archiveUrlIdentity"='blocked'`
			)
		).toEqual([]);
	});
	it('excludes a large future backlog and exposes indexable checkpoint/hash joins without ANALYZE', async () => {
		await cursor();
		await legacy(first, 'reused');
		await seed([
			{ objectType: 'bucket', bucketHash: 'reused', checkpointLedger: 63 },
			{}
		]);
		await db.query(
			`insert into history_archive_object_queue
			("archiveUrlIdentity", "remoteId", "objectKey", "checkpointLedger")
			select $1, gen_random_uuid(), 'future:' || value, $2 + value * 64
			from generate_series(1, 2000) value`,
			[root, last]
		);
		expect(await candidates()).toHaveLength(2);
		const plan = await db.transaction(async (manager) => {
			await manager.query('set local enable_seqscan = off');
			return manager.query(
				`explain (format json)
				select candidate.id from (${historyArchiveReadyCohortCandidatesSql('$1::text')}) candidate`,
				[root]
			);
		});
		// Do not pin the planner to one index name: the partial executable index
		// also supports parameterized checkpoint conditions on this small fixture.
		const conditions = queueIndexConditions(plan);
		expect(
			conditions.some(
				(condition) =>
					condition.includes('"archiveUrlIdentity"') &&
					condition.includes(
						'"checkpointLedger" >= chain_cursor.first_checkpoint'
					) &&
					condition.includes(
						'"checkpointLedger" <= chain_cursor.last_checkpoint'
					)
			)
		).toBe(true);
		expect(
			conditions.some(
				(condition) =>
					condition.includes('"archiveUrlIdentity"') &&
					condition.includes('"bucketHash" = dependency."bucketHash"')
			)
		).toBe(true);
	});
});

function queueIndexConditions(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap(queueIndexConditions);
	if (typeof value !== 'object' || value === null) return [];
	const own =
		'Relation Name' in value &&
		value['Relation Name'] === 'history_archive_object_queue' &&
		'Index Cond' in value &&
		typeof value['Index Cond'] === 'string'
			? [value['Index Cond']]
			: [];
	const children: unknown[] = Object.values(value);
	return [...own, ...children.flatMap(queueIndexConditions)];
}

const readyRowsSql = `select "objectRemoteId", "archiveUrlIdentity", priority,
	"availableAt", "dispatchToken", "publishedAt" from history_archive_object_ready order by "objectRemoteId"`;
const schemaSql = `
	create table history_archive_object_queue (
		id serial primary key, "remoteId" uuid unique not null,
		"archiveUrlIdentity" text not null, "hostIdentity" text not null default 'archive.example',
		"objectType" text not null default 'ledger', "objectKey" text not null,
		"objectOrder" integer not null default 20, "checkpointLedger" integer, "bucketHash" text,
		status text not null default 'pending', "executionDisposition" text default 'executable',
		"executionReason" text, "dependencyReady" boolean default true,
		"transitionEffectsRequiredAt" timestamptz, "transitionEffectsCompletedAt" timestamptz,
		"nextAttemptAt" timestamptz, "lastClaimedAt" timestamptz,
		"updatedAt" timestamptz not null default '2000-01-01', "verifiedAt" timestamptz,
		"dependenciesMaterializedAt" timestamptz
	);
	create index idx_history_archive_object_checkpoint_refresh on history_archive_object_queue
		("archiveUrlIdentity", "checkpointLedger", "objectType", status) where "checkpointLedger" is not null;
	create index idx_history_archive_object_bucket_hash on history_archive_object_queue
		("archiveUrlIdentity", "bucketHash") include (status, "executionDisposition", "dependencyReady")
		where "objectType"='bucket' and "bucketHash" is not null;
	create index idx_history_archive_object_executable_claim on history_archive_object_queue
		("archiveUrlIdentity", status, "nextAttemptAt", "lastClaimedAt", "objectOrder", "checkpointLedger", "objectKey", id)
		where "executionDisposition"='executable' and "dependencyReady"=true and status in ('pending','failed');
	create table history_archive_checkpoint_scan_cursor
		("archiveUrlIdentity" text primary key, "nextHistoricalCheckpointLedger" integer);
	create table history_archive_checkpoint_bucket_dependency (
		"archiveUrlIdentity" text, "checkpointLedger" integer, "bucketHash" text,
		"createdAt" timestamptz default now(), primary key ("archiveUrlIdentity","checkpointLedger","bucketHash"));
	create table history_archive_checkpoint_content_observation (
		"archiveUrlIdentity" text, "checkpointLedger" integer, "contentDigest" text,
		"checkpointStateObjectRemoteId" uuid, "createdAt" timestamptz default now(),
		primary key ("archiveUrlIdentity","checkpointLedger"));
	create table history_archive_checkpoint_content ("contentDigest" text primary key, "bucketSetDigest" text);
	create table history_archive_checkpoint_bucket_set_member
		("bucketSetDigest" text, "bucketHash" text, primary key ("bucketSetDigest","bucketHash"));
	create table history_archive_object_ready (
		"objectRemoteId" uuid primary key, "archiveUrlIdentity" text, priority smallint,
		"availableAt" timestamptz, "createdAt" timestamptz default now(), "updatedAt" timestamptz default now(),
		"dispatchToken" uuid, "publishedAt" timestamptz);
	create table history_archive_object_host_throttle ("hostIdentity" text primary key, "blockedUntil" timestamptz);
	create table history_archive_state_snapshot
		("archiveUrlIdentity" text primary key, status text, "networkPassphrase" text);
	create table full_history_promotion_runtime
		("network_passphrase_hash" bytea primary key, state text, "checkpoint_ledger" bigint, "last_outcome" text, "last_error_code" text);
	create table full_history_watermark ("network_passphrase_hash" bytea primary key, "first_ledger" bigint);
	create table full_history_historical_backfill_job
		(id uuid, "network_passphrase_hash" bytea, "first_checkpoint_ledger" bigint,
		"last_checkpoint_ledger" bigint, state text, "created_at" timestamptz);
`;
