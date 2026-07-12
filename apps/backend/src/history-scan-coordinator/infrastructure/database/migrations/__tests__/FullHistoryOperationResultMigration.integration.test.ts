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

jest.setTimeout(60_000);

describe('FullHistoryOperationResultMigration1785010000000', () => {
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
		await runner.commitTransaction();
		await runner.release();
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('adds immutable typed outcome rows with exact batch/operation provenance', async () => {
		const migration = new FullHistoryOperationResultMigration1785010000000();
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await expect(migration.up(runner)).rejects.toThrow(/active transaction/i);
		await runner.startTransaction();
		await migration.up(runner);
		await runner.commitTransaction();
		await runner.release();

		await expect(columns('full_history_operation_result')).resolves.toEqual([
			'fact_scope',
			'network_passphrase_hash',
			'operation_index',
			'operation_result_code',
			'operation_specific_result_code',
			'outcome',
			'transaction_hash'
		]);
		await expect(
			columns('full_history_operation_result_batch_coverage')
		).resolves.toEqual([
			'batch_id',
			'fact_scope',
			'first_ledger',
			'last_ledger',
			'network_passphrase_hash',
			'operation_count',
			'result_decoder_version'
		]);

		const input = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 1_501
		});
		await new TypeOrmFullHistoryCanonicalRepository(dataSource).writeCheckpoint(
			input
		);
		const rows = await dataSource.query<
			Array<{
				readonly batchId: string;
				readonly factScope: string;
				readonly operationResultCode: number | null;
				readonly operationSpecificResultCode: number | null;
				readonly outcome: string;
			}>
		>(
			`select operation."batch_id" as "batchId", result."outcome",
				result."operation_result_code" as "operationResultCode",
				result."operation_specific_result_code"
					as "operationSpecificResultCode",
				result."fact_scope" as "factScope"
			 from "full_history_operation_result" result
			 join "full_history_operation" operation
				on operation."network_passphrase_hash" =
					result."network_passphrase_hash"
				and operation."transaction_hash" = result."transaction_hash"
				and operation."operation_index" = result."operation_index"
			 where operation."batch_id" = $1`,
			[input.batchId]
		);
		expect(rows).toEqual([
			{
				batchId: input.batchId,
				factScope: 'transaction_result_xdr',
				operationResultCode: 0,
				operationSpecificResultCode: 0,
				outcome: 'succeeded'
			}
		]);
		await expect(
			dataSource.query(
				`update "full_history_operation_result" set "outcome" = 'failed'
				 where "transaction_hash" = $1`,
				[input.transactions[0]!.transactionHash.toBuffer()]
			)
		).rejects.toThrow(/immutable/i);
		await expect(
			dataSource.query(
				`update "full_history_operation_result_batch_coverage"
				 set "operation_count" = 0 where "batch_id" = $1`,
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
});
