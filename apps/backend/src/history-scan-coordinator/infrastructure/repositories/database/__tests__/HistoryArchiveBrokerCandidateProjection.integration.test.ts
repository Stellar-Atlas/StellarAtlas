import type { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { buildReserveBrokerJobsSql } from '../HistoryArchiveBrokerReservationSql.js';
import {
	historyArchiveBrokerCandidateProjectionSchemaSql,
	createHistoryArchiveBrokerCandidateProjectionSchemaSql,
	hydrateHistoryArchiveBrokerCandidatesSql,
	cleanupHistoryArchiveBrokerCandidatesSql,
	dropHistoryArchiveBrokerCandidateProjectionSql
} from '../HistoryArchiveBrokerCandidateProjection.js';
import {
	createEvidenceObject,
	createKnownEvidenceDataSource,
	resetKnownEvidence
} from './KnownArchiveEvidenceRepositoryFixture.js';

jest.setTimeout(60_000);
const projectionSql = buildReserveBrokerJobsSql(false);
const originalSql = buildReserveBrokerJobsSql(
	false,
	'history_archive_object_queue'
);
type Selected = { remoteId: string; selectedOrdinal: number; priority: number };

describe('transactional broker candidate projection', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await createKnownEvidenceDataSource(postgres.url);
		await db.query(`create table history_archive_object_ready (
		  "objectRemoteId" uuid primary key, "archiveUrlIdentity" text not null,
		  priority smallint not null, "availableAt" timestamptz not null,
		  "dispatchToken" uuid, "claimAttempt" integer, "publishedAt" timestamptz,
		  "recheckRequestedAt" timestamptz, "updatedAt" timestamptz not null)`);
		await db.query(historyArchiveBrokerCandidateProjectionSchemaSql);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	beforeEach(async () => {
		await db.query('truncate history_archive_object_ready');
		await db.query('truncate history_archive_broker_candidate');
		await resetKnownEvidence(db);
	});
	async function seed(
		root: string,
		count: number,
		priority = 2,
		host = new URL(root).host
	) {
		const objects = Array.from({ length: count }, (_, index) => {
			const checkpoint = index * 64 + 63;
			const object = createEvidenceObject(
				root,
				`ledger:${checkpoint.toString(16).padStart(8, '0')}`,
				'ledger',
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
			[objects.map((object) => object.remoteId), root, priority]
		);
		await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [null, 512]);
		return objects;
	}
	async function compare(
		limit: number,
		hostLimit: number,
		canonical: string | null = null
	) {
		return await db.transaction(async (manager) => {
			await manager.query('savepoint original_reservation');
			const original = (await manager.query(originalSql, [
				limit,
				hostLimit,
				2,
				canonical
			])) as Selected[];
			await manager.query('rollback to savepoint original_reservation');
			const projected = (await manager.query(projectionSql, [
				limit,
				hostLimit,
				2,
				canonical
			])) as Selected[];
			const identities = (rows: Selected[]) =>
				rows.map(({ remoteId, selectedOrdinal, priority }) => ({
					remoteId,
					selectedOrdinal,
					priority
				}));
			expect(identities(projected)).toEqual(identities(original));
			return projected;
		});
	}
	it('retains every sparse root, exact oldest timestamps and shared-host caps behind a deep backlog', async () => {
		await seed('https://a.example/history', 160);
		const b = await seed('https://b.example/history', 6, 2, 'shared.example');
		await seed('https://c.example/history', 6, 2, 'shared.example');
		await seed('https://d.example/history', 1);
		// The lane minimum is deliberately outside the first selectable prefix.
		await db.query(
			'update history_archive_object_ready set "updatedAt"=\'1990-01-01Z\' where "objectRemoteId"=$1',
			[b[5]!.remoteId]
		);
		const selected = await compare(8, 3);
		expect(selected).toHaveLength(7);
		expect(selected[0]!.remoteId).toBe(b[0]!.remoteId);
	});
	it('preserves retry budgets and explicit manual versus automatic definitive 4xx fencing', async () => {
		const failed = await seed('https://a.example/history', 8);
		await seed('https://b.example/history', 8, 0);
		await db.query(
			`update history_archive_object_queue set status='failed',"nextAttemptAt"='2000-01-01Z',
		 "errorType"='ERR_CANCELED',"errorMessage"='aborted' where "remoteId"=any($1::uuid[])`,
			[failed.map((row) => row.remoteId)]
		);
		await db.query(
			'update history_archive_object_queue set "httpStatus"=404 where "remoteId"=any($1::uuid[])',
			[[failed[0]!.remoteId, failed[1]!.remoteId]]
		);
		await db.query(
			`update history_archive_object_ready set "dispatchToken"=gen_random_uuid(),"claimAttempt"=1,
		 "recheckRequestedAt"=case when "objectRemoteId"=$1 then now() end where "objectRemoteId"=any($2::uuid[])`,
			[failed[0]!.remoteId, [failed[0]!.remoteId, failed[1]!.remoteId]]
		);
		const selected = await compare(8, 8);
		expect(selected.some((row) => row.remoteId === failed[1]!.remoteId)).toBe(
			false
		);
		const remaining = await compare(16, 16);
		expect(remaining.some((row) => row.remoteId === failed[0]!.remoteId)).toBe(
			true
		);
	});
	it('preserves exact adaptive probe, category cooldown and healthy root eligibility', async () => {
		const a = await seed('https://a.example/history', 6);
		await seed('https://b.example/history', 6);
		await seed('https://c.example/history', 6);
		await db.query(`insert into history_archive_root_failure_control
		 ("archiveUrlIdentity",scope,"failureKind","adaptiveProbeState","nextProbeCheckpoint","blockedUntil") values
		 ('https://a.example/history','ledger','missing','{"unknown":[[1,999]]}',191,null),
		 ('https://b.example/history','ledger','transient',null,null,now()+interval '1 hour')`);
		const selected = await compare(6, 8);
		expect(selected.some((row) => row.remoteId === a[2]!.remoteId)).toBe(true);
		expect(
			selected.filter((row) =>
				a.some((object) => object.remoteId === row.remoteId)
			)
		).toHaveLength(1);
	});
	it('does not rewrite projection rows for bytes/facts/heartbeat-only queue updates', async () => {
		const [object] = await seed('https://a.example/history', 1);
		const [before] = await db.query(
			'select xmin::text from history_archive_broker_candidate where "remoteId"=$1',
			[object!.remoteId]
		);
		await db.query(
			'update history_archive_object_queue set "bytesDownloaded"=123,"updatedAt"=now() where "remoteId"=$1',
			[object!.remoteId]
		);
		const [after] = await db.query(
			'select xmin::text from history_archive_broker_candidate where "remoteId"=$1',
			[object!.remoteId]
		);
		expect(after.xmin).toBe(before.xmin);
	});
	it('sees a same-statement queue transition before its ready upsert', async () => {
		const [object] = await seed('https://a.example/history', 1);
		await db.query('delete from history_archive_object_ready');
		await db.query(cleanupHistoryArchiveBrokerCandidatesSql);
		await db.query(
			`with changed as (
		 update history_archive_object_queue set "dependencyReady"=false where "remoteId"=$1 returning *
		) insert into history_archive_object_ready
		 ("objectRemoteId","archiveUrlIdentity",priority,"availableAt","updatedAt")
		 select "remoteId","archiveUrlIdentity",2,now(),now() from changed`,
			[object!.remoteId]
		);
		await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [null, 512]);
		expect(
			await db.query(
				'select "dependencyReady" from history_archive_broker_candidate'
			)
		).toEqual([{ dependencyReady: false }]);
		expect(await compare(1, 8)).toHaveLength(0);
	});
	it('removes all per-candidate queue heap probes from the actual eligible plan', async () => {
		await seed('https://a.example/history', 128);
		await seed('https://b.example/history', 128);
		type Plan = {
			'Subplan Name'?: string;
			'Relation Name'?: string;
			'Actual Loops'?: number;
			Plans?: Plan[];
		};
		const probeCount = async (sql: string) =>
			await db.transaction(async (manager) => {
				await manager.query('savepoint plan');
				const [row] = await manager.query(
					`explain (analyze,format json) ${sql}`,
					[8, 8, 2, null]
				);
				await manager.query('rollback to savepoint plan');
				const flatten = (plan: Plan): Plan[] => [
					plan,
					...(plan.Plans ?? []).flatMap(flatten)
				];
				const plan = (row['QUERY PLAN'] as { Plan: Plan }[])[0]!.Plan;
				const eligible = flatten(plan).find(
					(node) => node['Subplan Name'] === 'CTE eligible'
				);
				expect(eligible).toBeDefined();
				return flatten(eligible!)
					.filter(
						(node) => node['Relation Name'] === 'history_archive_object_queue'
					)
					.reduce((total, node) => total + (node['Actual Loops'] ?? 0), 0);
			});
		expect(await probeCount(originalSql)).toBeGreaterThanOrEqual(256);
		expect(await probeCount(projectionSql)).toBe(0);
	});
	it('explicitly places both heap and primary index in a validated configured tablespace', () => {
		const sql = createHistoryArchiveBrokerCandidateProjectionSchemaSql(
			'stellaratlas_archive_control_nvme'
		);
		expect(sql).toContain(
			'primary key using index tablespace "stellaratlas_archive_control_nvme"'
		);
		expect(sql).toContain(') tablespace "stellaratlas_archive_control_nvme";');
		expect(() =>
			createHistoryArchiveBrokerCandidateProjectionSchemaSql(
				'bad;drop table queue'
			)
		).toThrow('Invalid broker candidate tablespace');
	});
	it('updates eligibility transactionally and removes only the completed ready projection', async () => {
		const objects = await seed('https://a.example/history', 2);
		await db.query(
			'update history_archive_object_queue set "dependencyReady"=false where "remoteId"=$1',
			[objects[0]!.remoteId]
		);
		const selected = await compare(2, 8);
		expect(selected.map((row) => row.remoteId)).toEqual([objects[1]!.remoteId]);
		await db.query(
			'delete from history_archive_object_ready where "objectRemoteId"=$1',
			[objects[1]!.remoteId]
		);
		await db.query(cleanupHistoryArchiveBrokerCandidatesSql);
		const rows = await db.query(
			'select "remoteId" from history_archive_broker_candidate'
		);
		expect(rows).toEqual([{ remoteId: objects[0]!.remoteId }]);
	});
	it('bootstrap touches only bounded ready identities and leaves their scheduling fields unchanged', async () => {
		await seed('https://a.example/history', 6);
		await db.query('truncate history_archive_broker_candidate');
		const before = await db.query(
			'select * from history_archive_object_ready order by "objectRemoteId"'
		);
		const [first] = await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [
			null,
			2
		]);
		expect(first.hydrated).toBe(2);
		const [second] = await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [
			first.cursor,
			2
		]);
		expect(second.hydrated).toBe(2);
		await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [
			second.cursor,
			2
		]);
		expect(
			await db.query(
				'select * from history_archive_object_ready order by "objectRemoteId"'
			)
		).toEqual(before);
		expect(
			await db.query('select "remoteId" from history_archive_broker_candidate')
		).toHaveLength(6);
	});
	it('supports reverting the additive projection without deleting queue or ready evidence', async () => {
		await seed('https://a.example/history', 1);
		await db.query(dropHistoryArchiveBrokerCandidateProjectionSql);
		expect(
			await db.query(
				'select "objectRemoteId" from history_archive_object_ready'
			)
		).toHaveLength(1);
		await db.query(historyArchiveBrokerCandidateProjectionSchemaSql);
		await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [null, 2]);
		expect(await compare(1, 8)).toHaveLength(1);
	});
});
