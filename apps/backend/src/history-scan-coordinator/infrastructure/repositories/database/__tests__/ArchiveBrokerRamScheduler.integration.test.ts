import type { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { ArchiveBrokerRamScheduler } from '../../../cli/archive-broker/ArchiveBrokerRamScheduler.js';
import type { ArchiveBrokerRamSelected } from '../../../cli/archive-broker/ArchiveBrokerRamTypes.js';
import { HistoryArchiveRamCandidateFeed } from '../HistoryArchiveRamCandidateFeed.js';
import { buildReserveBrokerJobsSql } from '../HistoryArchiveBrokerReservationSql.js';
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
const rootA = 'https://ram-a.example/history';
const rootB = 'https://ram-b.example/history';
const rootC = 'https://ram-c.example/history';
const sql = buildReserveBrokerJobsSql(
	false,
	'history_archive_broker_candidate',
	'first-pass'
);
const end = sql.indexOf('), lockable as materialized (');
if (end < 0) throw new Error('Pure selected prefix not found');
const oracle =
	sql.slice(0, end + 1) +
	`
 select selected."objectRemoteId" as "remoteId",selected."selectedOrdinal",
 to_char(eligible.first_pass_root_ready_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "firstPassRootReadyAt"
 from selected join eligible using ("objectRemoteId") where eligible.is_first_pass
 order by selected."selectedOrdinal"`;

describe('RAM first-pass selection matches PostgreSQL same-snapshot oracle', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	let serial = 0;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await createKnownEvidenceDataSource(postgres.url);
		await db.query(`create table history_archive_object_ready (
   "objectRemoteId" uuid primary key,"archiveUrlIdentity" text not null,priority smallint not null,
   "availableAt" timestamptz not null,"updatedAt" timestamptz not null,"dispatchToken" uuid,
   "claimAttempt" integer,"publishedAt" timestamptz,"recheckRequestedAt" timestamptz)`);
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
		serial = 0;
	});
	async function seed(
		root: string,
		count: number,
		type: HistoryArchiveObject['objectType'] = 'ledger',
		priority = 2
	) {
		const objects = Array.from({ length: count }, (_, index) => {
			const object = createEvidenceObject(
				root,
				`${type}:ram-${serial++}`,
				type,
				'pending'
			);
			object.checkpointLedger = index * 64 + 63;
			object.executionDisposition = 'executable';
			object.dependencyReady = true;
			return object;
		});
		await db.getRepository(HistoryArchiveObject).save(objects);
		await db.query(
			`insert into history_archive_object_ready ("objectRemoteId","archiveUrlIdentity",priority,"availableAt","updatedAt")
   select id,$2,$3,'2000-01-01Z','2001-01-01Z' from unnest($1::uuid[]) id`,
			[objects.map((o) => o.remoteId), root, priority]
		);
		await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [null, 8192]);
		return objects;
	}
	async function compare(
		limit = 12,
		hostCap = 8,
		maximumPriority = 2,
		canonicalRoot: string | null = null
	) {
		return db.transaction('REPEATABLE READ', async (manager) => {
			const scheduler = new ArchiveBrokerRamScheduler();
			const feed = new HistoryArchiveRamCandidateFeed({
				query: manager.query.bind(manager)
			});
			let cursor: string | null = null;
			for (;;) {
				const page = await feed.snapshotPage(cursor);
				scheduler.apply(page.rows);
				cursor = page.nextCursor;
				if (!page.hasMore) break;
			}
			const context = await feed.loadContext(canonicalRoot, scheduler.roots());
			const expected = await manager.query<ArchiveBrokerRamSelected[]>(oracle, [
				limit,
				hostCap,
				maximumPriority,
				canonicalRoot
			]);
			const actual = scheduler.take({
				limit,
				maximumPerHost: hostCap,
				maximumPriority,
				context
			});
			expect(actual).toEqual(expected);
			expect(
				scheduler.take({
					limit,
					maximumPerHost: hostCap,
					maximumPriority,
					context
				})
			).toEqual(actual);
			return actual;
		});
	}
	it('preserves priorities, root rounds, shared-host caps and oldest age outside the bounded prefix', async () => {
		const a = await seed(rootA, 20);
		const b = await seed(rootB, 12);
		await seed(rootC, 8, 'transactions', 1);
		await db.query(
			`update history_archive_object_queue set "hostIdentity"='shared.example' where "archiveUrlIdentity"=any($1::text[])`,
			[[rootA, rootB]]
		);
		await db.query(
			`update history_archive_object_ready set "updatedAt"='1999-01-01 00:00:00.000001Z' where "objectRemoteId"=$1`,
			[a.at(-1)!.remoteId]
		);
		await db.query(
			`update history_archive_object_ready set "updatedAt"='1999-01-01 00:00:00.000002Z' where "objectRemoteId"=$1`,
			[b.at(-1)!.remoteId]
		);
		expect(await compare(12, 5)).toHaveLength(10);
		await compare(1, 1);
		await compare(30, 8);
		await compare(20, 8, 1);
	});
	it('preserves NULL checkpoints, category holes, object order and timestamp microseconds', async () => {
		const a = await seed(rootA, 8, 'bucket');
		const b = await seed(rootB, 8, 'results');
		await db.query(
			`update history_archive_object_queue set "checkpointLedger"=null where "remoteId"=any($1::uuid[])`,
			[[a[1]!.remoteId, a[4]!.remoteId, b[2]!.remoteId]]
		);
		await db.query(
			`update history_archive_object_ready set priority=0 where "objectRemoteId"=any($1::uuid[])`,
			[[a[3]!.remoteId, b[4]!.remoteId]]
		);
		await db.query(
			`update history_archive_object_ready set "updatedAt"='2001-01-01 00:00:00.000002Z' where "archiveUrlIdentity"=$1`,
			[rootA]
		);
		await db.query(
			`update history_archive_object_ready set "updatedAt"='2001-01-01 00:00:00.000001Z' where "archiveUrlIdentity"=$1`,
			[rootB]
		);
		await compare(12, 8);
		await compare(4, 2, 0);
	});
	it('excludes attempted, published, future, deferred and transition-blocked rows but retains token overrides', async () => {
		const a = await seed(rootA, 10);
		const ids = a.map((o) => o.remoteId);
		await db.query(
			`update history_archive_object_queue set attempts=1 where "remoteId"=$1`,
			[ids[0]]
		);
		await db.query(
			`update history_archive_object_queue set "dependencyReady"=false where "remoteId"=any($1::uuid[])`,
			[[ids[1], ids[5]]]
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
			`update history_archive_object_ready set "availableAt"='2099-01-01Z' where "objectRemoteId"=$1`,
			[ids[4]]
		);
		await db.query(
			`update history_archive_object_ready set "dispatchToken"=gen_random_uuid() where "objectRemoteId"=$1`,
			[ids[5]]
		);
		await db.query(
			`update history_archive_object_ready set "publishedAt"=now() where "objectRemoteId"=$1`,
			[ids[6]]
		);
		expect((await compare()).map((row) => row.remoteId).sort()).toEqual(
			[ids[5], ids[7], ids[8], ids[9]].sort()
		);
	});
	it('intersects wildcard/category adaptive probes, including NULL and contradictory targets', async () => {
		const a = await seed(rootA, 6);
		await seed(rootA, 3, 'bucket');
		await seed(rootB, 6);
		await db.query(
			`insert into history_archive_root_failure_control ("archiveUrlIdentity",scope,"failureKind","adaptiveProbeState","nextProbeCheckpoint")
   values($1,'*','missing','{"unknown":[{}]}',127),($1,'ledger','missing','{"unknown":[{}]}',127)`,
			[rootA]
		);
		await compare();
		await db.query(
			`update history_archive_root_failure_control set "nextProbeCheckpoint"=null where "archiveUrlIdentity"=$1 and scope='ledger'`,
			[rootA]
		);
		await compare();
		await db.query(
			`update history_archive_root_failure_control set "nextProbeCheckpoint"=null where "archiveUrlIdentity"=$1`,
			[rootA]
		);
		await db.query(
			`update history_archive_object_queue set "checkpointLedger"=null where "remoteId"=$1`,
			[a[2]!.remoteId]
		);
		expect(
			(await compare()).some((row) => row.remoteId === a[2]!.remoteId)
		).toBe(true);
	});
	it('preserves one controlled probe and suppresses it for published/scanning peers and an unexpired lease', async () => {
		const a = await seed(rootA, 5);
		const b = await seed(rootB, 5);
		await db.query(
			`insert into history_archive_root_failure_control ("archiveUrlIdentity",scope,"failureKind","blockedUntil") values($1,'ledger','transient','2000-01-01Z')`,
			[rootA]
		);
		expect(await compare()).toHaveLength(6);
		await db.query(
			`update history_archive_object_ready set "publishedAt"=now() where "objectRemoteId"=$1`,
			[a[4]!.remoteId]
		);
		expect(await compare()).toHaveLength(5);
		await db.query(
			`update history_archive_object_ready set "publishedAt"=null where "objectRemoteId"=$1`,
			[a[4]!.remoteId]
		);
		await db.query(
			`update history_archive_object_queue set status='scanning' where "remoteId"=$1`,
			[a[4]!.remoteId]
		);
		await db.query(
			`insert into history_archive_object_claim_slot(slot,"objectRemoteId","claimAttempt","claimedAt","updatedAt") values(1,$1,1,now(),now())`,
			[a[4]!.remoteId]
		);
		expect(await compare()).toHaveLength(5);
		await db.query('delete from history_archive_object_claim_slot');
		await db.query(
			`update history_archive_root_failure_control set "probeLeaseUntil"=now()+interval '1 hour',"probeExecutionId"=gen_random_uuid() where "archiveUrlIdentity"=$1`,
			[rootA]
		);
		await db.query(
			`update history_archive_object_ready set "dispatchToken"=gen_random_uuid() where "objectRemoteId"=$1`,
			[a[0]!.remoteId]
		);
		expect((await compare()).map((row) => row.remoteId).sort()).toEqual(
			b.map((o) => o.remoteId).sort()
		);
	});
	it('keeps canonical-first token bypass distinct from host-throttle and exclusion policy', async () => {
		const a = await seed(rootA, 3);
		const b = await seed(rootB, 3);
		await db.query(
			`insert into history_archive_state_snapshot ("archiveUrl","archiveUrlIdentity","stateUrl",status,"observedAt",source,"currentLedger") values($1,$1,$1||'/root','available',now(),'history-scanner',639)`,
			[rootA]
		);
		await db.query(
			`insert into history_archive_checkpoint_scan_cursor ("archiveUrlIdentity","nextHistoricalCheckpointLedger","latestCheckpointLedger") values($1,63,639)`,
			[rootA]
		);
		expect(await compare(12, 8, 2, rootA)).toHaveLength(3);
		await db.query(
			`update history_archive_object_ready set "dispatchToken"=gen_random_uuid() where "objectRemoteId"=$1`,
			[b[0]!.remoteId]
		);
		expect(await compare(12, 8, 2, rootA)).toHaveLength(4);
		await db.query(
			`insert into history_archive_object_host_throttle values($1,now()+interval '1 hour')`,
			[b[0]!.hostIdentity]
		);
		expect(
			(await compare(12, 8, 2, rootA)).map((row) => row.remoteId).sort()
		).toEqual(a.map((o) => o.remoteId).sort());
	});
	it('matches deterministic mixed-root metadata and context changes', async () => {
		for (let r = 0; r < 8; r++)
			for (const [t, type] of [
				'ledger',
				'transactions',
				'results',
				'bucket'
			].entries()) {
				const objects = await seed(
					`https://ram-${r}.example/history`,
					9,
					type as HistoryArchiveObject['objectType'],
					(r + t) % 3
				);
				for (let i = 0; i < objects.length; i++) {
					await db.query(
						`update history_archive_object_ready set "updatedAt"='2001-01-01Z'::timestamptz+($2::integer*interval '1 microsecond'),
     "availableAt"=case when $3::boolean then '2099-01-01Z'::timestamptz else '2000-01-01Z'::timestamptz end where "objectRemoteId"=$1`,
						[
							objects[i]!.remoteId,
							(i * 37 + r * 11 + t) % 97,
							(r + t + i) % 11 === 0
						]
					);
				}
			}
		await db.query(
			`update history_archive_object_queue set "hostIdentity"='pair.example' where "archiveUrlIdentity" in ('https://ram-1.example/history','https://ram-2.example/history')`
		);
		for (const limit of [1, 3, 12, 120]) await compare(limit, 8);
		await db.query(
			`insert into history_archive_root_failure_control ("archiveUrlIdentity",scope,"failureKind","blockedUntil") values('https://ram-3.example/history','*','transient','2000-01-01Z')`
		);
		await compare(120, 8);
		await compare(12, 3, 1);
	});
	it('refreshes coalesced identity updates and deletions without consuming selections before claim', async () => {
		const a = await seed(rootA, 5);
		const b = await seed(rootB, 5);
		const scheduler = new ArchiveBrokerRamScheduler();
		const feed = new HistoryArchiveRamCandidateFeed(db);
		scheduler.apply((await feed.snapshotPage(null)).rows);
		await db.query(
			`delete from history_archive_object_ready where "objectRemoteId"=$1`,
			[a[0]!.remoteId]
		);
		await db.query(
			`update history_archive_object_queue set attempts=1 where "remoteId"=$1`,
			[a[1]!.remoteId]
		);
		await db.query(
			`update history_archive_object_ready set "publishedAt"=now() where "objectRemoteId"=$1`,
			[b[0]!.remoteId]
		);
		await db.query(
			`update history_archive_object_ready set priority=0,"updatedAt"='1999-01-01 00:00:00.000003Z' where "objectRemoteId"=$1`,
			[b[3]!.remoteId]
		);
		const ids = [
			a[0]!.remoteId,
			a[1]!.remoteId,
			b[0]!.remoteId,
			b[3]!.remoteId
		];
		const refreshed = await feed.refreshIds(ids);
		scheduler.apply(
			refreshed,
			ids.filter((id) => !refreshed.some((row) => row.remoteId === id))
		);
		const context = await feed.loadContext(null, scheduler.roots());
		const actual = scheduler.take({
			limit: 12,
			maximumPerHost: 8,
			maximumPriority: 2,
			context
		});
		expect(actual).toEqual(await compare());
		expect(scheduler.size).toBe(7);
		scheduler.remove(actual.map((row) => row.remoteId));
		expect(scheduler.size).toBe(0);
	});
});
