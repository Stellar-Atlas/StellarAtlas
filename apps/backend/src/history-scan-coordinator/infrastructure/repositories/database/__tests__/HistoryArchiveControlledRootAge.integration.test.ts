import type { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { buildReserveBrokerJobsSql } from '../HistoryArchiveBrokerReservationSql.js';
import { historyArchiveBrokerFirstPassIndexes } from '../HistoryArchiveBrokerFirstPassAdmissionSql.js';
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
const root = 'https://controlled.example/history';
const other = 'https://healthy.example/history';
const optimized = buildReserveBrokerJobsSql(
	false,
	'history_archive_broker_candidate',
	'first-pass'
).split(', lockable as materialized (')[0];
// The only changed admission behavior is the exact equivalent age-lookup gate.
const reference = optimized.replace(
	'where scope.has_uncontrolled_scope',
	'where true'
);
type Selected = { objectRemoteId: string; selectedOrdinal: number };
interface Plan {
	'Subplan Name'?: string;
	'Relation Name'?: string;
	'Index Name'?: string;
	'Actual Loops': number;
	'Actual Rows': number;
	Plans?: Plan[];
}
const flatten = (plan: Plan): Plan[] => [
	plan,
	...(plan.Plans ?? []).flatMap(flatten)
];

describe('controlled root oldest-ready lookup', () => {
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
		identity: string,
		count: number,
		type: HistoryArchiveObject['objectType'] = 'ledger'
	) {
		const objects = Array.from({ length: count }, (_, i) => {
			const checkpoint = 63 + i * 64;
			const object = createEvidenceObject(
				identity,
				`${type}:${checkpoint.toString(16).padStart(8, '0')}`,
				type,
				'pending'
			);
			object.checkpointLedger = checkpoint;
			object.hostIdentity = new URL(identity).host;
			object.executionDisposition = 'executable';
			object.dependencyReady = true;
			return object;
		});
		await db.getRepository(HistoryArchiveObject).save(objects, { chunk: 200 });
		await db.query(
			`insert into history_archive_object_ready
      ("objectRemoteId","archiveUrlIdentity",priority,"availableAt","updatedAt")
      select id,$2,2,'2000-01-01Z','2001-01-01Z' from unnest($1::uuid[]) id`,
			[objects.map((o) => o.remoteId), identity]
		);
		for (let remaining = count; remaining > 0; remaining -= 512) {
			await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [null, 512]);
		}
		return objects;
	}
	async function control(
		scope: string,
		blockedUntil: string | null,
		unknown: readonly number[][] = [],
		next: number | null = null
	) {
		await db.query(
			`insert into history_archive_root_failure_control
      ("archiveUrlIdentity",scope,"failureKind","blockedUntil","adaptiveProbeState","nextProbeCheckpoint")
      values($1,$2,'missing',$3,$4::jsonb,$5)`,
			[root, scope, blockedUntil, JSON.stringify({ unknown }), next]
		);
	}
	async function compare(limit = 8, hostLimit = 8) {
		const args = [limit, hostLimit, 2, null];
		const before = (await db.query(
			`${reference} select * from selected order by "selectedOrdinal"`,
			args
		)) as Selected[];
		const after = (await db.query(
			`${optimized} select * from selected order by "selectedOrdinal"`,
			args
		)) as Selected[];
		expect(after).toEqual(before);
		return after.map((row) => row.objectRemoteId);
	}
	async function ages() {
		return db.query(
			`${optimized} select "archiveUrlIdentity",has_uncontrolled_scope,first_pass_root_ready_at from fresh_root_minimum`,
			[8, 8, 2, null]
		);
	}
	async function agePlan(sql: string): Promise<Plan[]> {
		const [row] = await db.query(
			`explain(analyze,format json) ${sql} select * from fresh_root_minimum`,
			[8, 8, 2, null]
		);
		const plan = flatten(row['QUERY PLAN'][0].Plan as Plan).find(
			(p) => p['Subplan Name'] === 'CTE fresh_root_minimum'
		);
		expect(plan).toBeDefined();
		return flatten(plan!);
	}
	it('does not inspect a large all-controlled prefix but preserves the half-open probe', async () => {
		const objects = await seed(root, 2048);
		await control('ledger', '2000-01-01Z');
		await db.query('analyze history_archive_object_ready');
		await db.query('analyze history_archive_broker_candidate');
		const before = await agePlan(reference);
		const after = await agePlan(optimized);
		expect(
			before.some(
				(p) =>
					p['Relation Name'] === 'history_archive_broker_candidate' &&
					p['Actual Loops'] >= 2048
			)
		).toBe(true);
		expect(
			after
				.filter((p) => p['Relation Name'] === 'history_archive_object_ready')
				.every((p) => p['Actual Loops'] === 0)
		).toBe(true);
		expect(
			after.some((p) => p['Index Name'] === 'history_archive_ready_root_oldest')
		).toBe(true);
		expect(await compare()).toEqual([objects[0]!.remoteId]);
		expect(await ages()).toEqual([
			{
				archiveUrlIdentity: root,
				has_uncontrolled_scope: false,
				first_pass_root_ready_at: null
			}
		]);
	});
	it('keeps mixed-category exact oldest age beyond the checkpoint prefix and sparse-root fairness', async () => {
		const controlled = await seed(root, 80);
		const tx = await seed(root, 40, 'transactions');
		const healthy = await seed(other, 1);
		await control('ledger', '2000-01-01Z');
		await db.query(
			'update history_archive_object_ready set "updatedAt"=\'1995-01-01Z\' where "objectRemoteId"=$1',
			[healthy[0]!.remoteId]
		);
		await db.query(
			'update history_archive_object_ready set "updatedAt"=\'1990-01-01Z\' where "objectRemoteId"=$1',
			[tx[39]!.remoteId]
		);
		const rows = await compare(4, 3);
		expect(rows).toContain(controlled[0]!.remoteId);
		expect(rows).toContain(healthy[0]!.remoteId);
		expect([controlled[0]!.remoteId, tx[0]!.remoteId]).toContain(rows[0]);
		expect(
			(await ages()).find(
				(r: { archiveUrlIdentity: string }) => r.archiveUrlIdentity === root
			)
		).toMatchObject({
			has_uncontrolled_scope: true,
			first_pass_root_ready_at: new Date('1990-01-01Z')
		});
	});
	it.each(['2000-01-01Z', '2099-01-01Z'])(
		'treats non-null cooldown presence exactly even when expired: %s',
		async (blocked) => {
			await seed(root, 3);
			await control('*', blocked);
			await compare();
			expect((await ages())[0]).toMatchObject({
				has_uncontrolled_scope: false,
				first_pass_root_ready_at: null
			});
		}
	);
	it('retains exact adaptive point admission without an ordinary oldest timestamp', async () => {
		const objects = await seed(root, 3, 'checkpoint-state');
		await control('checkpoint-state', null, [[63, 191]], 127);
		expect(await compare()).toEqual([objects[1]!.remoteId]);
		expect((await ages())[0]).toMatchObject({
			has_uncontrolled_scope: false,
			first_pass_root_ready_at: null
		});
	});
	it('does not suppress a completed adaptive state or a different category', async () => {
		const objects = await seed(root, 2);
		await control('ledger', null);
		await control('transactions', '2099-01-01Z');
		expect(await compare()).toEqual(objects.map((o) => o.remoteId));
		expect((await ages())[0]).toMatchObject({
			has_uncontrolled_scope: true,
			first_pass_root_ready_at: new Date('2001-01-01Z')
		});
	});
	it('preserves explicit manual and exact current-frontier recovery lanes', async () => {
		const fresh = await seed(root, 1);
		await control('ledger', '2000-01-01Z');
		const [manual] = await seed(other, 1, 'transactions');
		const [recovery] = await seed(other, 1, 'results');
		await db.query(
			`insert into history_archive_checkpoint_scan_cursor
      ("archiveUrlIdentity","latestCheckpointLedger","nextHistoricalCheckpointLedger") values($1,191,127)`,
			[other]
		);
		await db.query(
			`update history_archive_object_queue set status='failed',attempts=1,"httpStatus"=case when "remoteId"=$1 then 404 else 503 end,"nextAttemptAt"='2000-01-01Z' where "remoteId"=any($2::uuid[])`,
			[manual!.remoteId, [manual!.remoteId, recovery!.remoteId]]
		);
		await db.query(
			`update history_archive_object_ready set "dispatchToken"=gen_random_uuid(),"claimAttempt"=2,"recheckRequestedAt"=now() where "objectRemoteId"=$1`,
			[manual!.remoteId]
		);
		expect(await compare()).toEqual(
			expect.arrayContaining([
				fresh[0]!.remoteId,
				manual!.remoteId,
				recovery!.remoteId
			])
		);
	});
});
