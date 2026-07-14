import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { FullHistoryLedgerCloseMetaRetentionMigration1785070000000 } from '../1785070000000-FullHistoryLedgerCloseMetaRetentionMigration.js';

jest.setTimeout(60_000);

describe('FullHistoryLedgerCloseMetaRetentionMigration rollback', () => {
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

	it('removes the complete schema inside one transaction', async () => {
		const migration =
			new FullHistoryLedgerCloseMetaRetentionMigration1785070000000();
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		await migration.up(runner);
		await runner.commitTransaction();

		await runner.startTransaction();
		await migration.down(runner);
		await runner.commitTransaction();
		await runner.release();

		const rows = await dataSource.query<Array<{ readonly name: string }>>(
			`select table_name as name from information_schema.tables
			 where table_schema = 'public'
				and table_name like 'full_history_ledger_close_meta_%'`
		);
		expect(rows).toEqual([]);
	});
});
