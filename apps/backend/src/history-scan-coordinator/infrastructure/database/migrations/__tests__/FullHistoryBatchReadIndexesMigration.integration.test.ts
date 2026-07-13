import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { FullHistoryBatchReadIndexesMigration1785030000000 } from '../1785030000000-FullHistoryBatchReadIndexesMigration.js';

jest.setTimeout(60_000);

interface IndexRow {
	readonly columns: readonly string[];
	readonly indexName: string;
	readonly isReady: boolean;
	readonly isValid: boolean;
}

describe('FullHistoryBatchReadIndexesMigration with PostgreSQL', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			migrations: [FullHistoryBatchReadIndexesMigration1785030000000],
			migrationsRun: false,
			migrationsTransactionMode: 'each',
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		await createCanonicalTables(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('creates valid ready indexes outside a transaction and supports down/up', async () => {
		expect(await dataSource.runMigrations()).toHaveLength(1);
		expect(await readIndexes(dataSource)).toEqual([
			expect.objectContaining({
				columns: [
					'batch_id',
					'ledger_sequence',
					'transaction_index',
					'operation_index'
				],
				indexName: 'idx_full_history_operation_batch_order',
				isReady: true,
				isValid: true
			}),
			expect.objectContaining({
				columns: [
					'batch_id',
					'ledger_sequence',
					'transaction_index',
					'transaction_hash'
				],
				indexName: 'idx_full_history_transaction_result_batch_order',
				isReady: true,
				isValid: true
			})
		]);

		await dataSource.undoLastMigration();
		expect(await readIndexes(dataSource)).toEqual([]);
		expect(await dataSource.runMigrations()).toHaveLength(1);
		expect(await readIndexes(dataSource)).toHaveLength(2);
	});
});

async function createCanonicalTables(dataSource: DataSource): Promise<void> {
	await dataSource.query(`
		create table "full_history_transaction_result" (
			"batch_id" uuid not null,
			"ledger_sequence" bigint not null,
			"transaction_index" integer not null,
			"transaction_hash" bytea not null
		);
		create table "full_history_operation" (
			"batch_id" uuid not null,
			"ledger_sequence" bigint not null,
			"transaction_index" integer not null,
			"operation_index" integer not null
		)
	`);
}

async function readIndexes(dataSource: DataSource): Promise<IndexRow[]> {
	return dataSource.query<IndexRow[]>(`
		select index_class.relname as "indexName",
			index_state.indisready as "isReady",
			index_state.indisvalid as "isValid",
			array(
				select attribute.attname
				from unnest(index_state.indkey::smallint[]) with ordinality
					as index_key(attribute_number, position)
				join pg_attribute attribute
					on attribute.attrelid = index_state.indrelid
					and attribute.attnum = index_key.attribute_number
				order by index_key.position
			)::text[] as columns
		from pg_index index_state
		join pg_class index_class on index_class.oid = index_state.indexrelid
		where index_class.relname in (
			'idx_full_history_transaction_result_batch_order',
			'idx_full_history_operation_batch_order'
		)
		order by index_class.relname
	`);
}
