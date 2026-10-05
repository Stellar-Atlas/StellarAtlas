import type { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { buildReserveBrokerJobsSql } from '../HistoryArchiveBrokerReservationSql.js';
import {
	historyArchiveBrokerFirstPassIndexes,
	createHistoryArchiveBrokerFirstPassIndexes
} from '../HistoryArchiveBrokerFirstPassAdmissionSql.js';
import {
	historyArchiveBrokerCandidateProjectionSchemaSql,
	hydrateHistoryArchiveBrokerCandidatesSql
} from '../HistoryArchiveBrokerCandidateProjection.js';
import {
	createEvidenceObject,
	createKnownEvidenceDataSource,
	resetKnownEvidence
} from './KnownArchiveEvidenceRepositoryFixture.js';

jest.setTimeout(60_000);
const fast = buildReserveBrokerJobsSql(
	false,
	'history_archive_broker_candidate',
	'first-pass'
);
const reference = buildReserveBrokerJobsSql(
	false,
	'history_archive_object_queue',
	'first-pass'
);
const rootA = 'https://a.example/history';
const rootB = 'https://b.example/history';
type Row = { remoteId: string; priority: number; selectedOrdinal: number };

describe('bounded per-root first-pass admission', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await createKnownEvidenceDataSource(postgres.url);
		await db.query(`create table history_archive_object_ready (
			"objectRemoteId" uuid primary key,"archiveUrlIdentity" text not null,
			priority smallint not null,"availableAt" timestamptz not null,
			"dispatchToken" uuid,"claimAttempt" integer,"publishedAt" timestamptz,
			"recheckRequestedAt" timestamptz,"updatedAt" timestamptz not null)`);
		await db.query(historyArchiveBrokerCandidateProjectionSchemaSql);
		for (const sql of historyArchiveBrokerFirstPassIndexes) await db.query(sql);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	beforeEach(async () => {
		await db.query(
			'truncate history_archive_object_ready,history_archive_broker_candidate'
		);
		await resetKnownEvidence(db);
	});
	async function seed(
		root: string,
		count: number,
		priority = 2,
		type: 'ledger' | 'transactions' = 'ledger',
		host = new URL(root).host
	) {
		const objects = Array.from({ length: count }, (_, i) => {
			const checkpoint = i * 64 + 63;
			const object = createEvidenceObject(
				root,
				`${type}:${checkpoint.toString(16).padStart(8, '0')}`,
				type,
				'pending'
			);
			object.checkpointLedger = checkpoint;
			object.hostIdentity = host;
			object.executionDisposition = 'executable';
			object.dependencyReady = true;
			return object;
		});
		await db.getRepository(HistoryArchiveObject).save(objects);
		await db.query(
			`insert into history_archive_object_ready
			("objectRemoteId","archiveUrlIdentity",priority,"availableAt","updatedAt")
			select id,$2,$3,'2000-01-01Z','2001-01-01Z' from unnest($1::uuid[]) id`,
			[objects.map((o) => o.remoteId), root, priority]
		);
		await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [null, 8192]);
		return objects;
	}
	async function compare(
		limit: number,
		hostLimit: number,
		maximumPriority = 2
	) {
		return db.transaction(async (manager) => {
			await manager.query('savepoint comparison');
			const oldRows = (await manager.query(reference, [
				limit,
				hostLimit,
				maximumPriority,
				null
			])) as Row[];
			await manager.query('rollback to savepoint comparison');
			const rows = (await manager.query(fast, [
				limit,
				hostLimit,
				maximumPriority,
				null
			])) as Row[];
			const identity = (values: Row[]) =>
				values.map(({ remoteId, priority, selectedOrdinal }) => ({
					remoteId,
					priority,
					selectedOrdinal
				}));
			expect(identity(rows)).toEqual(identity(oldRows));
			return rows;
		});
	}
	function prefix(sql: string): string {
		return sql.slice(0, sql.indexOf(', root_probe_ranked as materialized'));
	}
	it('places every concurrent scheduling index in the explicit validated tablespace', () => {
		const indexes = createHistoryArchiveBrokerFirstPassIndexes(
			'stellaratlas_archive_control_nvme'
		);
		expect(indexes).toHaveLength(4);
		for (const sql of indexes) {
			expect(sql).toContain('create index concurrently if not exists');
			expect(sql).toContain(
				'tablespace "stellaratlas_archive_control_nvme" where'
			);
		}
		expect(() => createHistoryArchiveBrokerFirstPassIndexes('bad;sql')).toThrow(
			'Invalid broker first-pass tablespace'
		);
	});
	it('bounds the ranking input per root/category while preserving sparse roots and an oldest timestamp outside the prefix', async () => {
		await seed(rootA, 400);
		const b = await seed(rootB, 100);
		const c = await seed('https://c.example/history', 1);
		await db.query(
			'update history_archive_object_ready set "updatedAt"=\'1990-01-01Z\' where "objectRemoteId"=$1',
			[b[99]!.remoteId]
		);
		const [count] = await db.query(
			`${prefix(fast)} select count(*)::int as count from eligible`,
			[8, 3, 2, null]
		);
		expect(count.count).toBe(7);
		const rows = await compare(8, 3);
		expect(rows[0]!.remoteId).toBe(b[0]!.remoteId);
		expect(rows.some((r) => r.remoteId === c[0]!.remoteId)).toBe(true);
	});
	it('uses ordered fresh-candidate and oldest-ready index probes before bounded ranking', async () => {
		await seed(rootA, 250);
		await seed(rootB, 250);
		await db.query('analyze history_archive_object_ready');
		await db.query('analyze history_archive_broker_candidate');
		const [explained] = await db.query(
			`explain(analyze,format json) ${prefix(fast)} select count(*) from eligible`,
			[8, 3, 2, null]
		);
		type Plan = {
			'Node Type': string;
			'Index Name'?: string;
			'Actual Rows': number;
			'Actual Loops': number;
			'Subplan Name'?: string;
			Plans?: Plan[];
		};
		const flatten = (plan: Plan): Plan[] => [
			plan,
			...(plan.Plans ?? []).flatMap(flatten)
		];
		const plans = flatten(explained['QUERY PLAN'][0].Plan as Plan);
		const fresh = plans.find(
			(plan) => plan['Subplan Name'] === 'CTE fresh_admission'
		);
		expect(fresh?.['Actual Rows']).toBe(6);
		const indexes = plans.flatMap((plan) => plan['Index Name'] ?? []);
		expect(indexes).toContain('history_archive_candidate_fresh_order');
		expect(indexes).toContain('history_archive_ready_root_oldest');
		console.info(
			'first-pass indexed admission',
			plans
				.filter((plan) => plan['Index Name'] || plan['Node Type'] === 'Sort')
				.map((plan) => ({
					type: plan['Node Type'],
					index: plan['Index Name'],
					rows: plan['Actual Rows'],
					loops: plan['Actual Loops']
				}))
		);
	});
	it('pushes mutable eligibility and priority inside each prefix instead of letting blocked rows hide fresh work', async () => {
		const a = await seed(rootA, 80);
		const b = await seed(rootB, 2);
		await db.query(
			'update history_archive_object_queue set "dependencyReady"=false where "remoteId"=any($1::uuid[])',
			[a.slice(0, 70).map((o) => o.remoteId)]
		);
		await db.query(
			'update history_archive_object_ready set priority=1 where "objectRemoteId"=$1',
			[a[75]!.remoteId]
		);
		const rows = await compare(4, 2, 2);
		expect(rows[0]!.remoteId).toBe(a[75]!.remoteId);
		expect(rows.some((r) => r.remoteId === b[0]!.remoteId)).toBe(true);
		expect(rows.some((r) => r.remoteId === a[70]!.remoteId)).toBe(true);
	});
	it('preserves shared-host caps and independent controlled categories', async () => {
		const a = await seed(rootA, 20, 2, 'ledger', 'shared.example');
		const tx = await seed(rootA, 20, 2, 'transactions', 'shared.example');
		const b = await seed(rootB, 20, 2, 'ledger', 'shared.example');
		await db.query(
			`insert into history_archive_root_failure_control
			("archiveUrlIdentity",scope,"failureKind","blockedUntil") values ($1,'ledger','transient','2000-01-01Z')`,
			[rootA]
		);
		const rows = await compare(8, 3);
		expect(rows).toHaveLength(3);
		expect(
			rows.filter((r) => a.some((o) => o.remoteId === r.remoteId))
		).toHaveLength(1);
		expect(rows.some((r) => tx.some((o) => o.remoteId === r.remoteId))).toBe(
			true
		);
		expect(rows.some((r) => b.some((o) => o.remoteId === r.remoteId))).toBe(
			true
		);
	});
	it('places never-attempted work before an explicit manual retry without treating priority as manual provenance', async () => {
		const a = await seed(rootA, 2, 0);
		const b = await seed(rootB, 2, 2);
		await db.query(
			`update history_archive_object_queue set status='failed',attempts=1,"httpStatus"=404,"nextAttemptAt"='2000-01-01Z' where "remoteId"=any($1::uuid[])`,
			[a.map((o) => o.remoteId)]
		);
		await db.query(
			`update history_archive_object_ready set "dispatchToken"=gen_random_uuid(),"claimAttempt"=2,
			"recheckRequestedAt"=case when "objectRemoteId"=$1 then now() end where "objectRemoteId"=any($2::uuid[])`,
			[a[0]!.remoteId, a.map((o) => o.remoteId)]
		);
		const rows = await compare(4, 8);
		expect(rows.map((r) => r.remoteId)).toEqual([
			b[0]!.remoteId,
			b[1]!.remoteId,
			a[0]!.remoteId
		]);
	});
	it('does not rank a deep previously-attempted 404/503 backlog during first-pass', async () => {
		const a = await seed(rootA, 200, 0);
		const b = await seed(rootB, 2);
		await db.query(
			`update history_archive_object_queue set attempts=2,status='failed',"httpStatus"=503,"nextAttemptAt"='2000-01-01Z' where "remoteId"=any($1::uuid[])`,
			[a.map((o) => o.remoteId)]
		);
		const [count] = await db.query(
			`${prefix(fast)} select count(*)::int as count from eligible`,
			[8, 8, 2, null]
		);
		expect(count.count).toBe(2);
		expect((await compare(8, 8)).map((r) => r.remoteId)).toEqual(
			b.map((o) => o.remoteId)
		);
	});
	it('preserves null checkpoint positions, holes and disjoint priorities within a category', async () => {
		const a = await seed(rootA, 50);
		const b = await seed(rootB, 2, 2, 'transactions');
		await db.query(
			'update history_archive_object_ready set priority=1 where "objectRemoteId"=any($1::uuid[])',
			[[a[20]!.remoteId, a[40]!.remoteId]]
		);
		await db.query(
			'delete from history_archive_object_ready where "objectRemoteId"=any($1::uuid[])',
			[a.slice(21, 40).map((object) => object.remoteId)]
		);
		await db.query(
			'update history_archive_object_queue set "checkpointLedger"=null where "remoteId"=any($1::uuid[])',
			[[a[45]!.remoteId, b[0]!.remoteId]]
		);
		const rows = await compare(6, 4);
		expect(rows.slice(0, 2).map((row) => row.remoteId)).toEqual([
			a[20]!.remoteId,
			a[40]!.remoteId
		]);
		expect(rows.some((row) => row.remoteId === a[45]!.remoteId)).toBe(true);
		expect(rows.some((row) => row.remoteId === b[0]!.remoteId)).toBe(true);
	});
});
