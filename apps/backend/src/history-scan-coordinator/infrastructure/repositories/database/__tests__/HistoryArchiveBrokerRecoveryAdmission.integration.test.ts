import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import {
	historyArchiveBrokerRecoveryCandidatesSql,
	historyArchiveBrokerRecoveryCandidateIndexName,
	createHistoryArchiveBrokerRecoveryCandidateIndex
} from '../HistoryArchiveBrokerRecoveryAdmissionSql.js';
import { HistoryArchiveBrokerRecoveryCandidateIndexMigration1791310800000 } from '../../../database/migrations/1791310800000-HistoryArchiveBrokerRecoveryCandidateIndexMigration.js';

jest.setTimeout(60_000);
const sql = `with ${historyArchiveBrokerRecoveryCandidatesSql.replaceAll('$3::smallint', '$1::smallint')}
	select * from recovery_candidates order by "remoteId"`;
type Input = {
	status?: string;
	attempts?: number;
	type?: string;
	priority?: number;
	published?: boolean;
	delayed?: boolean;
	orphan?: boolean;
};

describe('nonfresh recovery admission subset', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	const migration =
		new HistoryArchiveBrokerRecoveryCandidateIndexMigration1791310800000();
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = new DataSource({ type: 'postgres', url: postgres.url });
		await db.initialize();
		await db.query(`create table history_archive_broker_candidate (
			"remoteId" uuid primary key,"archiveUrlIdentity" text not null,
			"objectType" text not null,"checkpointLedger" int,
			status text not null,attempts int not null);
			create table history_archive_object_ready (
			"objectRemoteId" uuid primary key,"archiveUrlIdentity" text not null,
			priority smallint not null,"availableAt" timestamptz not null,"publishedAt" timestamptz)`);
		const runner = db.createQueryRunner();
		try {
			await migration.up(runner);
		} finally {
			await runner.release();
		}
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	beforeEach(async () => {
		await db.query(
			'truncate history_archive_object_ready,history_archive_broker_candidate'
		);
	});
	async function seed(inputs: Input[]) {
		const rows = inputs.map((input) => ({
			id: randomUUID(),
			status: input.status ?? 'pending',
			attempts: input.attempts ?? 0,
			type: input.type ?? 'ledger',
			priority: input.priority ?? 2,
			published: input.published ?? false,
			delayed: input.delayed ?? false,
			orphan: input.orphan ?? false
		}));
		await db.query(
			`with input as materialized (
			select * from jsonb_to_recordset($1::jsonb) as i(id uuid,status text,attempts int,type text,
				priority smallint,published boolean,delayed boolean,orphan boolean)
		), candidates as (
			insert into history_archive_broker_candidate
			select id,'https://a.example',type,63,status,attempts from input
		)
		insert into history_archive_object_ready select id,'https://a.example',priority,
			case when delayed then '2099-01-01Z'::timestamptz else '2000-01-01Z'::timestamptz end,
			case when published then now() end from input where not orphan`,
			[JSON.stringify(rows)]
		);
		return rows.map((row) => row.id);
	}
	it('retains failed zero-attempt metadata and attempted pending/failed work only', async () => {
		const ids = await seed([
			{},
			{ type: 'history-archive-state', status: 'failed', attempts: 0 },
			{ attempts: 1 },
			{ status: 'failed', attempts: 2 },
			{ status: 'verified', attempts: 2 },
			{ status: 'scanning', attempts: 1 }
		]);
		expect(
			(await db.query(sql, [2])).map(
				(row: { remoteId: string }) => row.remoteId
			)
		).toEqual(ids.slice(1, 4).sort());
	});
	it('requires current due unpublished ready membership at the allowed priority', async () => {
		const ids = await seed([
			{ attempts: 1, priority: 1 },
			{ attempts: 1, priority: 2 },
			{ attempts: 1, published: true },
			{ attempts: 1, delayed: true },
			{ attempts: 1, orphan: true }
		]);
		expect(
			(await db.query(sql, [1])).map(
				(row: { remoteId: string }) => row.remoteId
			)
		).toEqual([ids[0]]);
	});
	it('keeps ready membership snapshot-consistent across concurrent publication', async () => {
		const [id] = await seed([{ attempts: 1 }]);
		const reader = db.createQueryRunner();
		await reader.startTransaction('REPEATABLE READ');
		try {
			const before = await reader.query(sql, [2]);
			await db.query(
				'update history_archive_object_ready set "publishedAt"=now() where "objectRemoteId"=$1',
				[id]
			);
			expect(await reader.query(sql, [2])).toEqual(before);
			await reader.commitTransaction();
		} finally {
			if (reader.isTransactionActive) await reader.rollbackTransaction();
			await reader.release();
		}
		expect(await db.query(sql, [2])).toEqual([]);
	});
	it('uses the small nonfresh index instead of scanning a fresh candidate majority', async () => {
		await db.query(`insert into history_archive_broker_candidate
			select md5(i::text)::uuid,'https://a.example','ledger',63,'pending',0 from generate_series(1,25000) i`);
		await seed(Array.from({ length: 12 }, () => ({ attempts: 1 })));
		await db.query(
			'analyze history_archive_broker_candidate; analyze history_archive_object_ready'
		);
		const plan = await db.query(`explain (format json) ${sql}`, [2]);
		expect(JSON.stringify(plan)).toContain(
			historyArchiveBrokerRecoveryCandidateIndexName
		);
		expect(await db.query(sql, [2])).toHaveLength(12);
	});
	it('creates a valid idempotent index in the candidate table tablespace and rejects unsafe names', async () => {
		const runner = db.createQueryRunner();
		try {
			await migration.up(runner);
		} finally {
			await runner.release();
		}
		const [index] = await db.query(
			`select i.indisvalid,i.indisready,
			c.reltablespace=q.reltablespace as same_tablespace
			from pg_index i join pg_class c on c.oid=i.indexrelid
			join pg_class q on q.oid=i.indrelid where c.relname=$1`,
			[historyArchiveBrokerRecoveryCandidateIndexName]
		);
		expect(index).toEqual({
			indisvalid: true,
			indisready: true,
			same_tablespace: true
		});
		expect(() =>
			createHistoryArchiveBrokerRecoveryCandidateIndex('x"; drop table x')
		).toThrow();
	});
});
