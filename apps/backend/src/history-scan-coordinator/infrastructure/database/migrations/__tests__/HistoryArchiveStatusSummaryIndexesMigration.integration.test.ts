import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveStatusSummaryIndexesMigration1784800000000 } from '../1784800000000-HistoryArchiveStatusSummaryIndexesMigration.js';

jest.setTimeout(60_000);

describe('HistoryArchiveStatusSummaryIndexesMigration recovery', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
		await dataSource.query(`
			create table history_archive_object_queue (
				"archiveUrlIdentity" text not null,
				"updatedAt" timestamptz not null,
				status text not null,
				"objectType" text not null
			)
		`);
		await dataSource.query(`
			create table history_archive_checkpoint_proof (
				"archiveUrlIdentity" text not null,
				"checkpointLedger" integer not null,
				status text not null,
				"requiredObjectsComplete" boolean not null
			)
		`);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('rebuilds an invalid concurrent index and remains rerunnable', async () => {
		const migration =
			new HistoryArchiveStatusSummaryIndexesMigration1784800000000();
		const runner = dataSource.createQueryRunner();
		expect(runner.isTransactionActive).toBe(false);

		await migration.up(runner);
		await dataSource.query(`
			update pg_index
			set indisvalid = false
			where indexrelid =
				'idx_history_archive_object_root_summary'::regclass
		`);
		await migration.up(runner);
		await migration.up(runner);

		const rows = (await dataSource.query(`
			select index_relation.relname as name, index_state.indisvalid as valid
			from pg_index index_state
			join pg_class index_relation
				on index_relation.oid = index_state.indexrelid
			where index_relation.relname =
				'idx_history_archive_object_root_summary'
			order by index_relation.relname
		`)) as readonly { readonly name: string; readonly valid: boolean }[];

		expect(rows).toEqual([
			{
				name: 'idx_history_archive_object_root_summary',
				valid: true
			}
		]);
		await runner.release();
	});
});
