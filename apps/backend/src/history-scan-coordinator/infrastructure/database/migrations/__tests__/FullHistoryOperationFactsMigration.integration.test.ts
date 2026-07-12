import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { TypeOrmFullHistoryCanonicalRepository } from '../../full-history/TypeOrmFullHistoryCanonicalRepository.js';
import {
	fullHistoryEntities,
	installFullHistoryPrerequisites,
	seedFullHistoryCheckpoint
} from '../../full-history/__tests__/FullHistoryCanonicalFixture.js';
import { FullHistoryCanonicalSchemaMigration1784860000000 } from '../1784860000000-FullHistoryCanonicalSchemaMigration.js';
import { FullHistoryOperationFactsMigration1784960000000 } from '../1784960000000-FullHistoryOperationFactsMigration.js';
import { FullHistoryOperationBackfillMigration1784970000000 } from '../1784970000000-FullHistoryOperationBackfillMigration.js';

jest.setTimeout(60_000);

describe('FullHistoryOperationFactsMigration1784960000000', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			entities: fullHistoryEntities,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		await installFullHistoryPrerequisites(runner);
		await new FullHistoryCanonicalSchemaMigration1784860000000().up(runner);
		await runner.commitTransaction();
		await runner.release();
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('adds immutable envelope-only operation facts without raw payload columns', async () => {
		const migration = new FullHistoryOperationFactsMigration1784960000000();
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await expect(migration.up(runner)).rejects.toThrow(/active transaction/i);
		await runner.startTransaction();
		await migration.up(runner);
		await runner.commitTransaction();
		await runner.release();

		const columns = await operationColumns();
		expect(columns).toEqual([
			'batch_id',
			'fact_scope',
			'ledger_sequence',
			'network_passphrase_hash',
			'operation_index',
			'operation_type',
			'source_account',
			'source_account_origin',
			'transaction_hash',
			'transaction_index'
		]);
		expect(
			columns.some((column) => /xdr|result|effect|event/i.test(column))
		).toBe(false);
		await expect(operationCoverageColumns()).resolves.toEqual([
			'batch_id',
			'fact_scope',
			'first_ledger',
			'last_ledger',
			'network_passphrase_hash',
			'operation_count',
			'transaction_count'
		]);
		const backfillMigration =
			new FullHistoryOperationBackfillMigration1784970000000();
		const upgrade = dataSource.createQueryRunner();
		await upgrade.connect();
		await upgrade.startTransaction();
		await backfillMigration.up(upgrade);
		await upgrade.commitTransaction();
		await upgrade.release();

		const input = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 1_496
		});
		const repository = new TypeOrmFullHistoryCanonicalRepository(dataSource);
		await repository.writeCheckpoint(input);
		await expect(
			dataSource.query(
				`update "full_history_operation"
				 set "operation_type" = 'manage_data'
				 where "batch_id" = $1`,
				[input.batchId]
			)
		).rejects.toThrow(/immutable/i);
		await expect(
			dataSource.query(
				`update "full_history_operation_batch_coverage"
				 set "operation_count" = 0
				 where "batch_id" = $1`,
				[input.batchId]
			)
		).rejects.toThrow(/immutable/i);

		const teardown = dataSource.createQueryRunner();
		await teardown.connect();
		await teardown.startTransaction();
		await backfillMigration.down(teardown);
		await migration.down(teardown);
		await teardown.commitTransaction();
		await teardown.release();
		await expect(operationColumns()).resolves.toEqual([]);
		await expect(operationCoverageColumns()).resolves.toEqual([]);
	});

	async function operationColumns(): Promise<string[]> {
		const rows = await dataSource.query<
			Array<{ readonly columnName: string }>
		>(`
			select column_name as "columnName"
			from information_schema.columns
			where table_name = 'full_history_operation'
			order by column_name
		`);
		return rows.map((row) => row.columnName);
	}

	async function operationCoverageColumns(): Promise<string[]> {
		const rows = await dataSource.query<
			Array<{ readonly columnName: string }>
		>(`
			select column_name as "columnName"
			from information_schema.columns
			where table_name = 'full_history_operation_batch_coverage'
			order by column_name
		`);
		return rows.map((row) => row.columnName);
	}
});
