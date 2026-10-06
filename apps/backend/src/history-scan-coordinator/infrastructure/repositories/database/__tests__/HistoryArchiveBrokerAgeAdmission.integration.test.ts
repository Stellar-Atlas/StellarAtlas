import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
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
function selected(sql: string): string {
	return (
		sql.slice(0, sql.indexOf('), lockable as materialized (') + 1) +
		'\nselect * from selected'
	);
}
const fast = selected(
	buildReserveBrokerJobsSql(
		false,
		'history_archive_broker_candidate',
		'first-pass'
	)
);
const reference = selected(
	buildReserveBrokerJobsSql(false, 'history_archive_object_queue', 'first-pass')
);
const rootA = 'https://age-a.example/history';
const rootB = 'https://age-b.example/history';
type Row = { objectRemoteId: string; selectedOrdinal: string };

describe('uncontrolled-category oldest eligible age', () => {
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
		priority = 2,
		age = '2001-01-01Z'
	) {
		const objects = Array.from({ length: count }, (_, index) => {
			const checkpoint = index * 64 + 63;
			const object = createEvidenceObject(
				root,
				`${type}:${checkpoint}`,
				type,
				'pending'
			);
			object.checkpointLedger = type === 'bucket' ? null : checkpoint;
			object.executionDisposition = 'executable';
			object.dependencyReady = true;
			return object;
		});
		await db.getRepository(HistoryArchiveObject).save(objects);
		await db.query(
			`insert into history_archive_object_ready
			("objectRemoteId","archiveUrlIdentity",priority,"availableAt","updatedAt")
			select id,$2,$3,'2000-01-01Z',$4 from unnest($1::uuid[]) id`,
			[objects.map((object) => object.remoteId), root, priority, age]
		);
		await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [null, 8192]);
		return objects;
	}
	async function control(root = rootA, scope = 'ledger') {
		await db.query(
			`insert into history_archive_root_failure_control
			("archiveUrlIdentity",scope,"failureKind","blockedUntil") values ($1,$2,'transient','2000-01-01Z')`,
			[root, scope]
		);
	}
	async function compare(manager: EntityManager = db.manager): Promise<Row[]> {
		const args = [8, 3, 2, null];
		const expected = (await manager.query(reference, args)) as Row[];
		const actual = (await manager.query(fast, args)) as Row[];
		expect(actual).toEqual(expected);
		return actual;
	}
	async function age(root: string): Promise<Date | null> {
		const sql = fast.slice(
			0,
			fast.indexOf(', root_probe_ranked as materialized')
		);
		const rows = (await db.query(
			`${sql} select "archiveUrlIdentity",first_pass_root_ready_at from fresh_root_minimum`,
			[8, 3, 2, null]
		)) as {
			archiveUrlIdentity: string;
			first_pass_root_ready_at: Date | null;
		}[];
		return (
			rows.find((row) => row.archiveUrlIdentity === root)
				?.first_pass_root_ready_at ?? null
		);
	}
	it('excludes a large controlled old prefix but retains independent uncontrolled category age', async () => {
		await seed(rootA, 300, 'ledger', 2, '1990-01-01Z');
		await seed(rootA, 4, 'transactions', 2, '2010-01-01Z');
		await seed(rootB, 4, 'ledger', 2, '2005-01-01Z');
		await control();
		await compare();
		expect((await age(rootA))?.getUTCFullYear()).toBe(2010);
		expect((await age(rootB))?.getUTCFullYear()).toBe(2005);
	});
	it('retains the exact oldest eligible timestamp beyond the admitted checkpoint prefix', async () => {
		const a = await seed(rootA, 30);
		await seed(rootB, 5, 'transactions', 2, '2000-01-01Z');
		await db.query(
			`update history_archive_object_ready set "updatedAt"='1980-01-01Z' where "objectRemoteId"=$1`,
			[a[29]!.remoteId]
		);
		const rows = await compare();
		expect(rows[0]?.objectRemoteId).toBe(a[0]?.remoteId);
		expect((await age(rootA))?.getUTCFullYear()).toBe(1980);
	});
	it('ignores future, published, attempted and absent-category priority holes', async () => {
		const a = await seed(rootA, 6, 'ledger', 2, '1990-01-01Z');
		await seed(rootA, 2, 'transactions', 1, '1980-01-01Z');
		await seed(rootB, 3, 'results', 2, '2000-01-01Z');
		await db.query(
			`update history_archive_object_ready set "availableAt"='2099-01-01Z' where "objectRemoteId"=$1`,
			[a[0]!.remoteId]
		);
		await db.query(
			`update history_archive_object_ready set "publishedAt"=now(),"dispatchToken"=$2,"claimAttempt"=1 where "objectRemoteId"=$1`,
			[a[1]!.remoteId, randomUUID()]
		);
		await db.query(
			`update history_archive_object_queue set attempts=1,status='pending' where "remoteId"=$1`,
			[a[2]!.remoteId]
		);
		await db.query(
			`update history_archive_object_ready set "updatedAt"='2010-01-01Z' where "objectRemoteId"=any($1::uuid[])`,
			[a.slice(3).map((object) => object.remoteId)]
		);
		await compare();
	});
	it('keeps full mutable eligibility and preserves an existing token override', async () => {
		await seed(rootA, 20, 'transactions', 2, '1980-01-01Z');
		await control(rootA, 'transactions');
		const a = await seed(rootA, 4, 'ledger', 2, '1990-01-01Z');
		await seed(rootB, 3, 'results', 2, '2000-01-01Z');
		await db.query(
			`update history_archive_object_queue set "dependencyReady"=false where "remoteId"=any($1::uuid[])`,
			[a.slice(0, 3).map((object) => object.remoteId)]
		);
		let rows = await compare();
		expect(rows.some((row) => row.objectRemoteId === a[0]!.remoteId)).toBe(
			false
		);
		await db.query(
			`update history_archive_object_ready set "dispatchToken"=$2,"claimAttempt"=1 where "objectRemoteId"=$1`,
			[a[0]!.remoteId, randomUUID()]
		);
		rows = await compare();
		expect(rows.some((row) => row.objectRemoteId === a[0]!.remoteId)).toBe(
			true
		);
	});
	it('preserves NULL-checkpoint age and wildcard-controlled no-age lanes', async () => {
		await seed(rootA, 1, 'bucket', 2, '1990-01-01Z');
		await seed(rootB, 3, 'ledger', 2, '2000-01-01Z');
		await compare();
		expect((await age(rootA))?.getUTCFullYear()).toBe(1990);
		await control(rootA, '*');
		await compare();
		expect(await age(rootA)).toBeNull();
	});
	it('uses one snapshot while a ready timestamp and control change concurrently', async () => {
		const a = await seed(rootA, 2);
		await seed(rootB, 2, 'ledger', 2, '2000-01-01Z');
		const reader = db.createQueryRunner();
		await reader.startTransaction('REPEATABLE READ');
		try {
			const before = await compare(reader.manager);
			await db.query(
				`update history_archive_object_ready set "updatedAt"='1980-01-01Z' where "objectRemoteId"=$1`,
				[a[0]!.remoteId]
			);
			await control();
			expect(await compare(reader.manager)).toEqual(before);
			await reader.commitTransaction();
		} finally {
			if (reader.isTransactionActive) await reader.rollbackTransaction();
			await reader.release();
		}
		await compare();
	});
});
