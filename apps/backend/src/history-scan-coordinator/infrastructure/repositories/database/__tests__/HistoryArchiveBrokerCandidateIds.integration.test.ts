import { randomUUID } from 'node:crypto';
import type { DataSource, QueryRunner } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { buildReserveBrokerJobsSql } from '../HistoryArchiveBrokerReservationSql.js';
import {
	buildReserveBrokerCandidateIdsSql,
	type HistoryArchiveBrokerCandidateId
} from '../HistoryArchiveBrokerCandidateIdsSql.js';
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
const oracle = buildReserveBrokerJobsSql(
	false,
	'history_archive_broker_candidate',
	'first-pass'
);
const exact = buildReserveBrokerCandidateIdsSql();
const rootA = 'https://candidate-a.example/history';
const rootB = 'https://candidate-b.example/history';
type Row = {
	remoteId: string;
	selectedOrdinal: number;
	dispatchToken: string;
	claimAttempt: number;
	archiveUrl: string;
	[key: string]: unknown;
};
const input = (
	objects: readonly HistoryArchiveObject[],
	age: string | null = '2001-01-01T00:00:00.000000Z'
): HistoryArchiveBrokerCandidateId[] =>
	objects.map((object, i) => ({
		remoteId: object.remoteId,
		selectedOrdinal: i + 1,
		firstPassRootReadyAt: age
	}));
const argumentsFor = (
	candidates: readonly HistoryArchiveBrokerCandidateId[],
	limit = 120,
	hostCap = 8
) => [limit, hostCap, 2, null, JSON.stringify(candidates)];
function comparable(rows: Row[]): unknown[] {
	return rows.map(({ dispatchToken: _token, ...row }) => row);
}

describe('exact RAM candidate admission', () => {
	let pg: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		pg = await startDisposablePostgres();
		db = await createKnownEvidenceDataSource(pg.url);
		await db.query(`create table history_archive_object_ready (
      "objectRemoteId" uuid primary key,"archiveUrlIdentity" text not null,
      priority smallint not null,"availableAt" timestamptz not null,
      "dispatchToken" uuid,"claimAttempt" integer,"publishedAt" timestamptz,
      "recheckRequestedAt" timestamptz,"updatedAt" timestamptz not null)`);
		await db.query(historyArchiveBrokerCandidateProjectionSchemaSql);
		for (const sql of historyArchiveBrokerFirstPassIndexes) await db.query(sql);
	});
	beforeEach(async () => {
		await db.query(
			'truncate history_archive_object_ready,history_archive_broker_candidate'
		);
		await resetKnownEvidence(db);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (pg) await pg.stop();
	});
	async function seed(
		root: string,
		count: number,
		type: HistoryArchiveObject['objectType'] = 'ledger',
		host = new URL(root).host
	) {
		const objects = Array.from({ length: count }, (_, i) => {
			const object = createEvidenceObject(
				root,
				`${type}:${i * 64 + 63}`,
				type,
				'pending'
			);
			object.checkpointLedger = type === 'bucket' ? null : i * 64 + 63;
			object.hostIdentity = host;
			object.executionDisposition = 'executable';
			object.dependencyReady = true;
			return object;
		});
		await db.getRepository(HistoryArchiveObject).save(objects);
		await db.query(
			`insert into history_archive_object_ready ("objectRemoteId","archiveUrlIdentity",priority,"availableAt","updatedAt")
      select id,$2,2,'2000-01-01Z','2001-01-01Z' from unnest($1::uuid[]) id`,
			[objects.map((o) => o.remoteId), root]
		);
		await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [null, 512]);
		return objects;
	}
	async function parity(limit = 8, hostCap = 3) {
		return db.transaction(async (manager) => {
			const prefix = oracle.slice(
				0,
				oracle.indexOf(', root_probe_ranked as materialized')
			);
			const ages = (await manager.query(
				`${prefix} select "archiveUrlIdentity",priority,to_char(first_pass_root_ready_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') age from fresh_root_minimum`,
				[limit, hostCap, 2, null]
			)) as {
				archiveUrlIdentity: string;
				priority: number;
				age: string | null;
			}[];
			await manager.query('savepoint original');
			const expected = (await manager.query(oracle, [
				limit,
				hostCap,
				2,
				null
			])) as Row[];
			await manager.query('rollback to savepoint original');
			const candidates = expected.map((row) => ({
				remoteId: row.remoteId,
				selectedOrdinal: row.selectedOrdinal,
				firstPassRootReadyAt:
					ages.find(
						(age) =>
							age.archiveUrlIdentity === row.archiveUrl &&
							age.priority === row.priority
					)?.age ?? null
			}));
			const actual = (await manager.query(
				exact,
				argumentsFor(candidates, limit, hostCap)
			)) as Row[];
			expect(comparable(actual)).toEqual(comparable(expected));
			return actual;
		});
	}
	it('matches the unchanged oracle order, shared host cap, sparse roots and microsecond root ages', async () => {
		await seed(rootA, 12, 'ledger', 'shared.example');
		await seed(rootB, 12, 'transactions', 'shared.example');
		await seed('https://sparse.example/history', 2, 'bucket');
		await db.query(
			`update history_archive_object_ready set "updatedAt"=case when "archiveUrlIdentity"=$1 then '2001-01-01T00:00:00.000002Z'::timestamptz else '2001-01-01T00:00:00.000001Z'::timestamptz end`,
			[rootA]
		);
		const rows = await parity(8, 3);
		expect(rows).toHaveLength(5);
	});
	it('retains controlled-category single probe and independent uncontrolled category admission', async () => {
		await seed(rootA, 10);
		await seed(rootA, 10, 'transactions');
		await seed(rootB, 5);
		await db.query(
			`insert into history_archive_root_failure_control ("archiveUrlIdentity",scope,"failureKind","blockedUntil") values ($1,'ledger','transient','2000-01-01Z')`,
			[rootA]
		);
		const rows = await parity();
		expect(
			rows.filter(
				(row) => row.archiveUrl === rootA && row.objectType === 'ledger'
			)
		).toHaveLength(1);
	});
	it('preserves global RAM ordinals when an unselected controlled probe contributes the root age', async () => {
		const [freshA] = await seed(rootA, 1);
		const [probeA] = await seed(rootA, 1, 'transactions');
		const [freshB] = await seed(rootB, 1);
		await db.query(
			`update history_archive_object_queue set "checkpointLedger"=127 where "remoteId"=$1`,
			[probeA!.remoteId]
		);
		await db.query(
			`update history_archive_object_ready set "updatedAt"=case
			when "objectRemoteId"=$1 then '2001-01-03Z'::timestamptz
			when "objectRemoteId"=$2 then '2001-01-01Z'::timestamptz
			else '2001-01-02Z'::timestamptz end`,
			[freshA!.remoteId, probeA!.remoteId]
		);
		await db.query(
			`insert into history_archive_root_failure_control ("archiveUrlIdentity",scope,"failureKind","blockedUntil") values ($1,'transactions','transient','2000-01-01Z')`,
			[rootA]
		);
		const rows = await parity(2, 8);
		expect(rows.map((row) => row.remoteId)).toEqual([
			freshA!.remoteId,
			freshB!.remoteId
		]);
	});
	it('rejects missing, published, future, attempted, failed and superseded stale identities', async () => {
		const rows = await seed(rootA, 7);
		await db.query(
			`delete from history_archive_object_ready where "objectRemoteId"=$1`,
			[rows[0]!.remoteId]
		);
		await db.query(
			`update history_archive_object_ready set "publishedAt"=now() where "objectRemoteId"=$1`,
			[rows[1]!.remoteId]
		);
		await db.query(
			`update history_archive_object_ready set "availableAt"='2099-01-01Z' where "objectRemoteId"=$1`,
			[rows[2]!.remoteId]
		);
		await db.query(
			`update history_archive_object_queue set attempts=1 where "remoteId"=$1`,
			[rows[3]!.remoteId]
		);
		await db.query(
			`update history_archive_object_queue set status='failed' where "remoteId"=$1`,
			[rows[4]!.remoteId]
		);
		await db.query(
			`update history_archive_object_queue set "executionDisposition"='superseded' where "remoteId"=$1`,
			[rows[5]!.remoteId]
		);
		const actual = (await db.query(exact, argumentsFor(input(rows)))) as Row[];
		expect(actual.map((row) => row.remoteId)).toEqual([rows[6]!.remoteId]);
	});
	it('honors current queue dependency/transition flags even when the projection is stale', async () => {
		const rows = await seed(rootA, 3);
		await db.query(
			'alter table history_archive_object_queue disable trigger history_archive_broker_candidate_refresh'
		);
		try {
			await db.query(
				`update history_archive_object_queue set "dependencyReady"=false where "remoteId"=$1`,
				[rows[0]!.remoteId]
			);
			await db.query(
				`update history_archive_object_queue set "transitionEffectsRequiredAt"=now(),"transitionEffectsCompletedAt"=null where "remoteId"=$1`,
				[rows[1]!.remoteId]
			);
			const actual = (await db.query(
				exact,
				argumentsFor(input(rows))
			)) as Row[];
			expect(actual.map((row) => row.remoteId)).toEqual([rows[2]!.remoteId]);
		} finally {
			await db.query(
				'alter table history_archive_object_queue enable trigger history_archive_broker_candidate_refresh'
			);
		}
	});
	it('preserves an existing token override and rejects host throttles', async () => {
		const rows = await seed(rootA, 2);
		const token = randomUUID();
		await db.query(
			`update history_archive_object_queue set "dependencyReady"=false,"executionDisposition"='deferred' where "remoteId"=$1`,
			[rows[0]!.remoteId]
		);
		await db.query(
			`update history_archive_object_ready set "dispatchToken"=$2,"claimAttempt"=1 where "objectRemoteId"=$1`,
			[rows[0]!.remoteId, token]
		);
		const actual = await db.query(exact, argumentsFor(input([rows[0]!])));
		expect(actual[0]?.dispatchToken).toBe(token);
		await db.query(
			`insert into history_archive_object_host_throttle values ($1,now()+interval '1 hour')`,
			[rows[1]!.hostIdentity]
		);
		expect(await db.query(exact, argumentsFor(input([rows[1]!])))).toEqual([]);
	});
	it('deduplicates candidate IDs, preserves rollback and prevents double publication after commit', async () => {
		const [object] = await seed(rootA, 1);
		const args = argumentsFor([...input([object!]), ...input([object!])]);
		const runner = db.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		try {
			expect(await runner.query(exact, args)).toHaveLength(1);
			expect(await db.query(exact, args)).toEqual([]);
			await runner.rollbackTransaction();
			expect(await db.query(exact, args)).toHaveLength(1);
			expect(await db.query(exact, args)).toEqual([]);
		} finally {
			if (runner.isTransactionActive) await runner.rollbackTransaction();
			await runner.release();
		}
	});
	it('keeps canonical-first admission while retaining its existing token exception', async () => {
		const a = await seed(rootA, 1);
		const b = await seed(rootB, 2);
		await db.query(
			`insert into history_archive_state_snapshot ("archiveUrl","archiveUrlIdentity","stateUrl",status,"observedAt",source,"currentLedger") values($1,$1,$1||'/root','available',now(),'history-scanner',639)`,
			[rootA]
		);
		await db.query(
			`insert into history_archive_checkpoint_scan_cursor ("archiveUrlIdentity","nextHistoricalCheckpointLedger","latestCheckpointLedger") values($1,63,639)`,
			[rootA]
		);
		await db.query(
			`update history_archive_object_ready set "dispatchToken"=gen_random_uuid(),"claimAttempt"=1 where "objectRemoteId"=$1`,
			[b[0]!.remoteId]
		);
		const args = argumentsFor(input([...a, ...b]));
		args[3] = rootA;
		const rows = (await db.query(exact, args)) as Row[];
		expect(rows.map((row) => row.remoteId).sort()).toEqual(
			[a[0]!.remoteId, b[0]!.remoteId].sort()
		);
	});
	it('respects adaptive exact checkpoint and does not bypass a lease with its own token', async () => {
		const rows = await seed(rootA, 3);
		await db.query(
			`insert into history_archive_root_failure_control ("archiveUrlIdentity",scope,"failureKind","adaptiveProbeState","nextProbeCheckpoint") values($1,'ledger','missing','{"unknown":[{"from":63,"through":191}]}',127)`,
			[rootA]
		);
		await db.transaction(async (manager) => {
			await manager.query('savepoint probe');
			const selected = (await manager.query(
				exact,
				argumentsFor(input(rows))
			)) as Row[];
			expect(selected.map((row) => row.remoteId)).toEqual([rows[1]!.remoteId]);
			await manager.query('rollback to savepoint probe');
			const token = randomUUID();
			await manager.query(
				`update history_archive_object_ready set "dispatchToken"=$2,"claimAttempt"=1 where "objectRemoteId"=$1`,
				[rows[1]!.remoteId, token]
			);
			await manager.query(
				`update history_archive_root_failure_control set "probeLeaseUntil"=now()+interval '1 hour',"probeExecutionId"=$2 where "archiveUrlIdentity"=$1`,
				[rootA, token]
			);
			expect(await manager.query(exact, argumentsFor(input(rows)))).toEqual([]);
		});
	});
	it('counts already published jobs against the host cap and excludes an active controlled scope', async () => {
		const rows = await seed(rootA, 4);
		await db.query(
			`update history_archive_object_ready set "publishedAt"=now(),"dispatchToken"=gen_random_uuid(),"claimAttempt"=1 where "objectRemoteId"=$1`,
			[rows[0]!.remoteId]
		);
		await db.transaction(async (manager) => {
			await manager.query('savepoint capped');
			expect(
				await manager.query(exact, argumentsFor(input(rows.slice(1)), 3, 2))
			).toHaveLength(1);
			await manager.query('rollback to savepoint capped');
			await manager.query(
				`insert into history_archive_root_failure_control ("archiveUrlIdentity",scope,"failureKind","blockedUntil") values($1,'ledger','transient','2000-01-01Z')`,
				[rootA]
			);
			expect(
				await manager.query(exact, argumentsFor(input(rows.slice(1)), 3, 2))
			).toEqual([]);
		});
	});
	it('skips a concurrently changing durable object and never authorizes from stale RAM', async () => {
		const rows = await seed(rootA, 1);
		const holder = db.createQueryRunner();
		await holder.connect();
		await holder.startTransaction();
		try {
			await holder.query(
				`update history_archive_object_queue set "dependencyReady"=false where "remoteId"=$1`,
				[rows[0]!.remoteId]
			);
			expect(await db.query(exact, argumentsFor(input(rows)))).toEqual([]);
			await holder.commitTransaction();
			expect(await db.query(exact, argumentsFor(input(rows)))).toEqual([]);
		} finally {
			if (holder.isTransactionActive) await holder.rollbackTransaction();
			await holder.release();
		}
	});
	it('rechecks a root cooldown changed while waiting for its row lock', async () => {
		const rows = await seed(rootA, 1);
		await db.query(
			`insert into history_archive_root_failure_control ("archiveUrlIdentity",scope,"failureKind") values ($1,'ledger','transient')`,
			[rootA]
		);
		const holder = db.createQueryRunner();
		const claimant = db.createQueryRunner();
		await holder.connect();
		await claimant.connect();
		await holder.startTransaction();
		await claimant.startTransaction();
		try {
			await holder.query(
				`select 1 from history_archive_root_failure_control where "archiveUrlIdentity"=$1 for update`,
				[rootA]
			);
			const [{ pid }] = (await claimant.query(
				'select pg_backend_pid() pid'
			)) as { pid: number }[];
			const claiming = claimant.query(exact, argumentsFor(input(rows)));
			await waitForLock(holder, pid!);
			await holder.query(
				`update history_archive_root_failure_control set "blockedUntil"=now()+interval '1 hour' where "archiveUrlIdentity"=$1`,
				[rootA]
			);
			await holder.commitTransaction();
			expect(await claiming).toEqual([]);
			await claimant.rollbackTransaction();
		} finally {
			if (holder.isTransactionActive) await holder.rollbackTransaction();
			if (claimant.isTransactionActive) await claimant.rollbackTransaction();
			await holder.release();
			await claimant.release();
		}
	});
	it('contains no global scope or root-age walk and bounds the JSON identities', () => {
		expect(exact).not.toContain('ready_scopes');
		expect(exact).not.toContain('fresh_root_minimum');
		expect(exact).toContain('limit greatest($1::integer,0)');
		expect(exact).toContain(
			"where object.status='pending' and object.attempts=0"
		);
		expect(exact).toContain('for update of ready skip locked');
		expect(exact).toContain('and ready."publishedAt" is null');
	});
});

async function waitForLock(runner: QueryRunner, pid: number): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		const rows = await runner.query(
			'select wait_event_type from pg_stat_activity where pid=$1',
			[pid]
		);
		if (rows[0]?.wait_event_type === 'Lock') return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error('Claim did not reach controlled root-row barrier');
}
