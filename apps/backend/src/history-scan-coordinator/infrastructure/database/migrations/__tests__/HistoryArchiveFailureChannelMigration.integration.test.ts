import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveFailureChannelMigration1784820000000 } from '../1784820000000-HistoryArchiveFailureChannelMigration.js';

jest.setTimeout(60_000);

describe('HistoryArchiveFailureChannelMigration', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	beforeEach(async () => {
		await dataSource.query('drop table if exists history_archive_object_event');
		await dataSource.query('drop table if exists history_archive_object_queue');
	});

	it('preserves legacy evidence and rolls both tables back completely', async () => {
		await createLegacyTables();
		const queryRunner = dataSource.createQueryRunner();
		await queryRunner.connect();
		const migration = new HistoryArchiveFailureChannelMigration1784820000000();

		try {
			await migration.up(queryRunner);
			await migration.up(queryRunner);
			const objects = (await dataSource.query(`
				select "errorType", "failureChannel"
				from history_archive_object_queue
				order by "errorType"
			`)) as readonly Record<string, unknown>[];
			const events = (await dataSource.query(`
				select "evidenceClass", "failureChannel"
				from history_archive_object_event
				order by "evidenceClass"
			`)) as readonly Record<string, unknown>[];

			expect(objects).toEqual([
				{ errorType: 'bucket_hash_mismatch', failureChannel: null },
				{ errorType: 'worker_pool_failure', failureChannel: null }
			]);
			expect(events).toEqual([
				{ evidenceClass: 'archive-object', failureChannel: null },
				{ evidenceClass: 'worker-infrastructure', failureChannel: null }
			]);
			await expect(
				dataSource.query(`
					insert into history_archive_object_queue (
						"remoteId", "archiveUrlIdentity", "objectType", status,
						"errorType", "failureChannel", "createdAt"
					) values (gen_random_uuid(), 'https://new.example', 'bucket', 'failed',
						'archive_http_error', 'unknown', now())
				`)
			).rejects.toThrow();
			await expect(
				dataSource.query(`
					insert into history_archive_object_queue (
						"remoteId", "archiveUrlIdentity", "objectType", status,
						"errorType", "failureChannel", "createdAt"
					) values (gen_random_uuid(), 'https://new.example', 'bucket', 'failed',
						'archive_http_error', 'archive_evidence', now())
				`)
			).resolves.toBeDefined();
			await migration.down(queryRunner);
			expect(await readFailureChannelArtifacts()).toEqual([]);
			await expect(readLegacyRowCounts()).resolves.toEqual({
				events: 2,
				objects: 3
			});
			await migration.down(queryRunner);
			expect(await readFailureChannelArtifacts()).toEqual([]);
		} finally {
			await migration.down(queryRunner);
			await queryRunner.release();
		}
	});

	it('times out on a contended table lock and succeeds on retry', async () => {
		await createLegacyTables();
		const blocker = dataSource.createQueryRunner();
		const runner = dataSource.createQueryRunner();
		await blocker.connect();
		await runner.connect();
		await blocker.startTransaction();
		await blocker.query(
			'lock table history_archive_object_queue in access exclusive mode'
		);
		const migration = new HistoryArchiveFailureChannelMigration1784820000000();
		const startedAt = Date.now();

		try {
			await expect(migration.up(runner)).rejects.toThrow(/lock timeout/i);
			expect(Date.now() - startedAt).toBeLessThan(8_000);
			await blocker.rollbackTransaction();
			await expect(migration.up(runner)).resolves.toBeUndefined();
			await expect(readFailureChannelArtifacts()).resolves.toHaveLength(4);
		} finally {
			if (blocker.isTransactionActive) await blocker.rollbackTransaction();
			await migration.down(runner);
			await blocker.release();
			await runner.release();
		}
	});

	async function readFailureChannelArtifacts(): Promise<readonly string[]> {
		const rows = (await dataSource.query(`
			select 'column:' || table_name as artifact
			from information_schema.columns
			where table_schema = current_schema()
				and table_name in (
					'history_archive_object_event',
					'history_archive_object_queue'
				)
				and column_name = 'failureChannel'
			union all
			select 'constraint:' || constraint_name
			from information_schema.table_constraints
			where table_schema = current_schema()
				and constraint_name in (
					'chk_history_archive_event_failure_channel',
					'chk_history_archive_object_failure_channel'
				)
			order by artifact
		`)) as readonly { readonly artifact: string }[];
		return rows.map((row) => row.artifact);
	}

	async function readLegacyRowCounts(): Promise<{
		readonly events: number;
		readonly objects: number;
	}> {
		const [row] = (await dataSource.query(`
			select
				(select count(*)::int from history_archive_object_event) as events,
				(select count(*)::int from history_archive_object_queue) as objects
		`)) as readonly { readonly events: number; readonly objects: number }[];
		if (row === undefined) throw new Error('Missing rollback row counts');
		return row;
	}

	async function createLegacyTables(): Promise<void> {
		await dataSource.query(`
			create table history_archive_object_queue (
				"remoteId" uuid primary key,
				"archiveUrlIdentity" text not null,
				"objectType" text not null,
				status text not null,
				"errorType" text,
				"createdAt" timestamptz not null
			)
		`);
		await dataSource.query(`
			create table history_archive_object_event (
				"remoteId" uuid primary key,
				"eventType" text not null,
				"evidenceClass" text,
				"createdAt" timestamptz not null
			)
		`);
		await dataSource.query(`
			insert into history_archive_object_queue (
				"remoteId", "archiveUrlIdentity", "objectType", status,
				"errorType", "createdAt"
			) values
				(gen_random_uuid(), 'https://a.example', 'bucket', 'failed',
					'bucket_hash_mismatch', now()),
				(gen_random_uuid(), 'https://b.example', 'ledger', 'failed',
					'worker_pool_failure', now())
		`);
		await dataSource.query(`
			insert into history_archive_object_event (
				"remoteId", "eventType", "evidenceClass", "createdAt"
			) values
				(gen_random_uuid(), 'failed', 'archive-object', now()),
				(gen_random_uuid(), 'failed', 'worker-infrastructure', now())
		`);
	}
});
