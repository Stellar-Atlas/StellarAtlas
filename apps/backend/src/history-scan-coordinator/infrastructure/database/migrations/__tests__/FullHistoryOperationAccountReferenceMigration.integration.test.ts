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
import { FullHistoryOperationResultMigration1785010000000 } from '../1785010000000-FullHistoryOperationResultMigration.js';
import { FullHistoryOperationAccountReferenceMigration1785040000000 } from '../1785040000000-FullHistoryOperationAccountReferenceMigration.js';

jest.setTimeout(60_000);

describe('FullHistoryOperationAccountReferenceMigration1785040000000', () => {
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
		await new FullHistoryOperationFactsMigration1784960000000().up(runner);
		await new FullHistoryOperationBackfillMigration1784970000000().up(runner);
		await new FullHistoryOperationResultMigration1785010000000().up(runner);
		await runner.commitTransaction();
		await runner.release();
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('adds immutable normalized references and exact batch coverage without payload columns', async () => {
		const migration =
			new FullHistoryOperationAccountReferenceMigration1785040000000();
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await expect(migration.up(runner)).rejects.toThrow(/active transaction/i);
		await runner.startTransaction();
		await migration.up(runner);
		await runner.commitTransaction();
		await runner.release();

		await expect(
			columns('full_history_operation_account_reference')
		).resolves.toEqual([
			'account_id',
			'base_account_id',
			'fact_scope',
			'network_passphrase_hash',
			'operation_index',
			'role',
			'transaction_hash'
		]);
		await expect(
			columns('full_history_operation_account_reference_batch_coverage')
		).resolves.toEqual([
			'account_reference_count',
			'batch_id',
			'fact_scope',
			'first_ledger',
			'last_ledger',
			'network_passphrase_hash',
			'operation_count',
			'reference_decoder_version'
		]);
		const allColumns = [
			...(await columns('full_history_operation_account_reference')),
			...(await columns(
				'full_history_operation_account_reference_batch_coverage'
			))
		];
		expect(allColumns.some((column) => /xdr|raw|payload/i.test(column))).toBe(
			false
		);
		await expect(triggerNames()).resolves.toEqual([
			'trg_reject_full_history_operation_account_ref_cov_mutation',
			'trg_reject_full_history_operation_account_reference_mutation'
		]);

		const input = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 5_040
		});
		await new TypeOrmFullHistoryCanonicalRepository(dataSource).writeCheckpoint(
			input
		);
		await expect(
			dataSource.query(
				`update "full_history_operation_account_reference"
				 set "role" = 'destination' where "transaction_hash" = $1`,
				[input.transactions[0]!.transactionHash.toBuffer()]
			)
		).rejects.toThrow(/immutable/i);
		await expect(
			dataSource.query(
				`delete from
				 "full_history_operation_account_reference_batch_coverage"
				 where "batch_id" = $1`,
				[input.batchId]
			)
		).rejects.toThrow(/immutable/i);
	});

	async function columns(tableName: string): Promise<string[]> {
		const rows = await dataSource.query<Array<{ readonly columnName: string }>>(
			`select column_name as "columnName" from information_schema.columns
			 where table_schema = current_schema() and table_name = $1
			 order by column_name`,
			[tableName]
		);
		return rows.map((row) => row.columnName);
	}

	async function triggerNames(): Promise<string[]> {
		const rows = await dataSource.query<
			Array<{ readonly triggerName: string }>
		>(
			`select trigger.tgname as "triggerName"
			 from pg_trigger trigger
			 join pg_class relation on relation.oid = trigger.tgrelid
			 where relation.relnamespace = current_schema()::regnamespace
				and relation.relname in (
					'full_history_operation_account_reference',
					'full_history_operation_account_reference_batch_coverage'
				)
				and not trigger.tgisinternal
			 order by trigger.tgname`
		);
		return rows.map((row) => row.triggerName);
	}
});
