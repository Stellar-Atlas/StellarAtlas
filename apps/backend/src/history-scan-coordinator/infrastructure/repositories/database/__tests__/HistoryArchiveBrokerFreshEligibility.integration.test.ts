import type { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { buildReserveBrokerJobsSql } from '../HistoryArchiveBrokerReservationSql.js';
import { historyArchiveBrokerFreshEligibilitySql } from '../HistoryArchiveBrokerFreshEligibilitySql.js';
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
const generic = buildReserveBrokerJobsSql(
	false,
	'history_archive_object_queue',
	'first-pass'
);
const commonEnd = generic.indexOf(', eligible as materialized');
const eligibleEnd = generic.indexOf(', root_probe_ranked as materialized');
const columns = `"objectRemoteId","archiveUrlIdentity",stored_priority,priority,is_first_pass,
 "dispatchToken","updatedAt","hostIdentity","checkpointLedger","objectOrder","objectType",
 control_scope,is_transient_source_retry,is_retry,active_count`;
const reference =
	generic.slice(0, eligibleEnd) +
	` select ${columns} from eligible where is_first_pass order by "objectRemoteId"`;
const specialized =
	generic.slice(0, commonEnd) +
	`, eligible as materialized (${historyArchiveBrokerFreshEligibilitySql()}) select ${columns} from eligible order by "objectRemoteId"`;
const rootA = 'https://fresh-a.example/history';
const rootB = 'https://fresh-b.example/history';

describe('fresh broker eligibility specialization', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await createKnownEvidenceDataSource(postgres.url);
		await db.query(`create table history_archive_object_ready (
   "objectRemoteId" uuid primary key,"archiveUrlIdentity" text not null,priority smallint not null,
   "availableAt" timestamptz not null,"dispatchToken" uuid,"claimAttempt" integer,"publishedAt" timestamptz,
   "recheckRequestedAt" timestamptz,"updatedAt" timestamptz not null)`);
		await db.query(historyArchiveBrokerCandidateProjectionSchemaSql);
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
		count: number,
		root = rootA,
		type: HistoryArchiveObject['objectType'] = 'ledger'
	) {
		const objects = Array.from({ length: count }, (_, i) => {
			const object = createEvidenceObject(
				root,
				`${type}:${(i * 64 + 63).toString(16).padStart(8, '0')}`,
				type,
				'pending'
			);
			object.checkpointLedger = i * 64 + 63;
			object.executionDisposition = 'executable';
			object.dependencyReady = true;
			return object;
		});
		await db.getRepository(HistoryArchiveObject).save(objects);
		await db.query(
			`insert into history_archive_object_ready ("objectRemoteId","archiveUrlIdentity",priority,"availableAt","updatedAt") select id,$2,2,'2000-01-01Z','2001-01-01Z' from unnest($1::uuid[]) id`,
			[objects.map((o) => o.remoteId), root]
		);
		await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [null, 512]);
		return objects;
	}
	async function compare(canonical: string | null = null, maximumPriority = 2) {
		return db.transaction('REPEATABLE READ', async (manager) => {
			const args = [maximumPriority, canonical];
			const bind = (sql: string) =>
				sql
					.replaceAll('$3::smallint', '$1::smallint')
					.replaceAll('$4::text', '$2::text');
			const expected = await manager.query(bind(reference), args);
			const actual = await manager.query(bind(specialized), args);
			expect(actual).toEqual(expected);
			return actual as {
				objectRemoteId: string;
				priority: number;
				is_first_pass: boolean;
				is_retry: boolean;
				is_transient_source_retry: boolean;
			}[];
		});
	}
	it('removes retained/retry work without changing first-pass flags or stored priorities', async () => {
		const objects = await seed(3);
		await db.query(
			`update history_archive_object_ready set priority=0 where "objectRemoteId"=$1`,
			[objects[0]!.remoteId]
		);
		await db.query(
			`update history_archive_object_queue set status='failed',"httpStatus"=503,"errorType"='archive_http_error',"errorMessage"='HTTP503',"failureChannel"='archive_availability' where "remoteId"=$1`,
			[objects[0]!.remoteId]
		);
		await db.query(
			`update history_archive_object_queue set status='pending',attempts=0 where "remoteId"=$1`,
			[objects[0]!.remoteId]
		);
		expect(
			await db.query(
				`select 1 from history_archive_retained_remote_finding where "objectRemoteId"=$1 and "retainedOnly"`,
				[objects[0]!.remoteId]
			)
		).toHaveLength(1);
		const rows = await compare();
		expect(rows).toHaveLength(3);
		expect(
			rows.every(
				(r) => r.is_first_pass && !r.is_retry && !r.is_transient_source_retry
			)
		).toBe(true);
		expect(
			rows.find((r) => r.objectRemoteId === objects[0]!.remoteId)?.priority
		).toBe(0);
		expect(historyArchiveBrokerFreshEligibilitySql()).not.toContain(
			'history_archive_retained_remote_finding'
		);
		expect(historyArchiveBrokerFreshEligibilitySql()).not.toContain(
			'recovery_cursor'
		);
	});
	it('preserves mutable readiness, token bypass, due time, publication and priority filters', async () => {
		const objects = await seed(8);
		const ids = objects.map((o) => o.remoteId);
		await db.query(
			`update history_archive_object_queue set "dependencyReady"=false where "remoteId"=any($1::uuid[])`,
			[[ids[1], ids[4]]]
		);
		await db.query(
			`update history_archive_object_queue set "executionDisposition"='deferred' where "remoteId"=$1`,
			[ids[2]]
		);
		await db.query(
			`update history_archive_object_queue set "transitionEffectsRequiredAt"=now(),"transitionEffectsCompletedAt"=null where "remoteId"=$1`,
			[ids[3]]
		);
		await db.query(
			`update history_archive_object_ready set "dispatchToken"=gen_random_uuid() where "objectRemoteId"=$1`,
			[ids[4]]
		);
		await db.query(
			`update history_archive_object_ready set "availableAt"='2099-01-01Z' where "objectRemoteId"=$1`,
			[ids[5]]
		);
		await db.query(
			`update history_archive_object_ready set "publishedAt"=now() where "objectRemoteId"=$1`,
			[ids[6]]
		);
		await db.query(
			`update history_archive_object_queue set attempts=1 where "remoteId"=$1`,
			[ids[7]]
		);
		expect((await compare()).map((r) => r.objectRemoteId).sort()).toEqual(
			[ids[0], ids[4]].sort()
		);
		expect(await compare(null, 1)).toEqual([]);
	});
	it('preserves adaptive exact-point control and does not introduce an own-token lease bypass', async () => {
		const objects = await seed(3);
		await db.query(
			`insert into history_archive_root_failure_control ("archiveUrlIdentity",scope,"failureKind","adaptiveProbeState","nextProbeCheckpoint") values($1,'ledger','missing','{"unknown":[{"from":63,"through":191}]}',127)`,
			[rootA]
		);
		expect((await compare()).map((r) => r.objectRemoteId)).toEqual([
			objects[1]!.remoteId
		]);
		await db.query(
			`update history_archive_object_ready set "dispatchToken"=gen_random_uuid() where "objectRemoteId"=$1`,
			[objects[1]!.remoteId]
		);
		await db.query(
			`update history_archive_root_failure_control set "probeLeaseUntil"=now()+interval '1 hour',"probeExecutionId"=(select "dispatchToken" from history_archive_object_ready where "objectRemoteId"=$1) where "archiveUrlIdentity"=$2`,
			[objects[1]!.remoteId, rootA]
		);
		expect(await compare()).toEqual([]);
	});
	it('retains canonical-first token semantics and host throttle despite fresh status', async () => {
		const a = await seed(1);
		const b = await seed(2, rootB);
		await db.query(
			`insert into history_archive_state_snapshot ("archiveUrl","archiveUrlIdentity","stateUrl",status,"observedAt",source,"currentLedger") values($1,$1,$1||'/root','available',now(),'history-scanner',639)`,
			[rootA]
		);
		await db.query(
			`insert into history_archive_checkpoint_scan_cursor ("archiveUrlIdentity","nextHistoricalCheckpointLedger","latestCheckpointLedger") values($1,63,639)`,
			[rootA]
		);
		expect((await compare(rootA)).map((r) => r.objectRemoteId)).toEqual([
			a[0]!.remoteId
		]);
		await db.query(
			`update history_archive_object_ready set "dispatchToken"=gen_random_uuid() where "objectRemoteId"=$1`,
			[b[0]!.remoteId]
		);
		expect(await compare(rootA)).toHaveLength(2);
		await db.query(
			`insert into history_archive_object_host_throttle values($1,now()+interval '1 hour')`,
			[b[0]!.hostIdentity]
		);
		expect((await compare(rootA)).map((r) => r.objectRemoteId)).toEqual([
			a[0]!.remoteId
		]);
	});
	it('keeps non-first-pass and durable-queue fallback on the general selector', () => {
		const recheck = buildReserveBrokerJobsSql(
			false,
			'history_archive_broker_candidate',
			'recheck'
		);
		expect(recheck).toContain('history_archive_retained_remote_finding');
		expect(recheck).not.toContain('fresh_admission as materialized');
		expect(generic).not.toContain('fresh_admission as materialized');
	});
});
