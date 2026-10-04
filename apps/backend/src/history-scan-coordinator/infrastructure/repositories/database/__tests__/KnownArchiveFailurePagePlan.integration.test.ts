import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { knownArchiveFailurePageSql } from '../KnownArchiveFailurePageQuery.js';

jest.setTimeout(60_000);

const root = 'https://rare-failures.example';
const snapshot = new Date('2026-10-03T00:00:00Z');
const id = (value: number) =>
	`00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

describe('rare archive failures amid newer successful objects', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = new DataSource({ type: 'postgres', url: postgres.url });
		await db.initialize();
		await db.query(`
			create table history_archive_object_queue (
				"remoteId" uuid primary key, "archiveUrlIdentity" text not null,
				"createdAt" timestamptz not null, "objectType" text not null,
				status text not null, "failureChannel" text
			);
			create index idx_history_archive_object_archive
				on history_archive_object_queue ("archiveUrlIdentity", status);
			create index idx_history_archive_object_evidence_summary
				on history_archive_object_queue ("archiveUrlIdentity", "createdAt")
				include (status, "objectType", "failureChannel");
			create table history_archive_retained_remote_finding (
				"objectRemoteId" uuid primary key, "archiveUrlIdentity" text,
				"objectCreatedAt" timestamptz, "objectType" text,
				"retainedOnly" boolean, "observedAt" timestamptz,
				"failureChannel" text, "errorType" text,
				"errorMessage" text, "httpStatus" integer
			)
		`);
		await db.query(
			`insert into history_archive_object_queue
			 select md5('healthy:' || n::text)::uuid, $1,
				'2026-10-02T00:00:00Z'::timestamptz + n * interval '1 second',
				'ledger', 'verified', null from generate_series(1,25000) n`,
			[root]
		);
		for (const [number, type, channel] of [
			[1, 'ledger', 'archive_availability'],
			[2, 'transactions', 'archive_evidence'],
			[3, 'ledger', 'scanner_issue']
		] as const) {
			await db.query(
				`insert into history_archive_object_queue values
				 ($1,$2,'2026-10-01T00:00:00Z',$3,'failed',$4)`,
				[id(number), root, type, channel]
			);
		}
		await db.query(
			`insert into history_archive_object_queue values
			 ($1,$2,'2026-10-01T00:00:00Z','ledger','pending',null);
			`,
			[id(4), root]
		);
		await db.query(
			`insert into history_archive_retained_remote_finding values
			 ($1,$2,'2026-10-01T00:00:00Z','ledger',true,'2026-10-01T00:00:00Z',
			 'archive_availability','archive_http_error','HTTP 503',503)`,
			[id(4), root]
		);
		await db.query('analyze history_archive_object_queue');
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('uses the failed-status index before sorting, without scanning newer successes', async () => {
		expect(knownArchiveFailurePageSql('remote')).toContain(
			'with failed_candidates as materialized'
		);
		const rows = await db.transaction(async (manager) => {
			await manager.query("set local statement_timeout = '3s'");
			return manager.query(
				`explain (analyze, buffers, format json) ${knownArchiveFailurePageSql('remote')}`,
				[[root], null, null, snapshot, null, null, 2]
			);
		});
		const plan = JSON.stringify(rows);
		expect(plan).toContain('idx_history_archive_object_archive');
		expect(plan).not.toContain('idx_history_archive_object_evidence_summary');
	});

	it('preserves retained findings, descending UUID ties, cursor boundaries and filters', async () => {
		const first = await db.query(knownArchiveFailurePageSql('remote'), [
			[root, root],
			null,
			null,
			snapshot,
			null,
			null,
			2
		]);
		expect(first.map((row: { remoteId: string }) => row.remoteId)).toEqual([
			id(4),
			id(2)
		]);
		expect(first[0].retainedFinding).toMatchObject({ httpStatus: 503 });
		const next = await db.query(knownArchiveFailurePageSql('remote'), [
			[root],
			null,
			null,
			snapshot,
			new Date('2026-10-01'),
			id(2),
			2
		]);
		expect(next.map((row: { remoteId: string }) => row.remoteId)).toEqual([
			id(1)
		]);
		const filtered = await db.query(knownArchiveFailurePageSql('remote'), [
			[root],
			root,
			'transactions',
			snapshot,
			null,
			null,
			2
		]);
		expect(filtered.map((row: { remoteId: string }) => row.remoteId)).toEqual([
			id(2)
		]);
		const infrastructure = await db.query(
			knownArchiveFailurePageSql('infrastructure'),
			[[root], null, null, snapshot, null, null, 2]
		);
		expect(
			infrastructure.map((row: { remoteId: string }) => row.remoteId)
		).toEqual([id(3)]);
	});
});
