import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import {
	installFullHistoryPrerequisites,
	seedFullHistoryCheckpoint
} from '../../full-history/__tests__/FullHistoryCanonicalFixture.js';
import { FullHistoryCanonicalSchemaMigration1784860000000 } from '../1784860000000-FullHistoryCanonicalSchemaMigration.js';

jest.setTimeout(60_000);

interface RelationSnapshot {
	readonly bytes: string;
	readonly relfilenode: string;
	readonly rows: readonly { readonly ctid: string; readonly xmin: string }[];
}

describe('FullHistoryCanonicalSchemaMigration1784860000000', () => {
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

	it('uses bounded locks, creates empty canonical tables without source rewrites, and rolls down', async () => {
		const setup = dataSource.createQueryRunner();
		await setup.connect();
		await setup.startTransaction();
		await installFullHistoryPrerequisites(setup);
		await setup.commitTransaction();
		await setup.release();
		await seedFullHistoryCheckpoint(dataSource, { batchNumber: 801 });

		const sourceBefore = await sourceSnapshots();
		const blocker = dataSource.createQueryRunner();
		const migrator = dataSource.createQueryRunner();
		await Promise.all([blocker.connect(), migrator.connect()]);
		const migration = new FullHistoryCanonicalSchemaMigration1784860000000();

		try {
			await expect(migration.up(migrator)).rejects.toThrow(
				/active transaction/i
			);
			await blocker.startTransaction();
			await blocker.query(
				'lock table "history_archive_checkpoint_proof" in access exclusive mode'
			);
			await migrator.startTransaction();
			const startedAt = Date.now();
			await expect(migration.up(migrator)).rejects.toThrow(/lock timeout/i);
			expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_500);
			expect(Date.now() - startedAt).toBeLessThan(10_000);
			await migrator.rollbackTransaction();
			await blocker.commitTransaction();
			expect(await canonicalRelations()).toEqual([]);

			await migrator.startTransaction();
			await migration.up(migrator);
			await migrator.commitTransaction();

			expect(await canonicalRelations()).toEqual([
				'full_history_ingestion_batch',
				'full_history_ledger',
				'full_history_transaction',
				'full_history_transaction_result',
				'full_history_watermark'
			]);
			expect(await sourceSnapshots()).toEqual(sourceBefore);
			expect(await canonicalRowCounts()).toEqual([0, 0, 0, 0, 0]);
			expect(await hashColumnTypes()).toEqual(
				expect.arrayContaining([
					{
						columnName: 'ledger_hash',
						dataType: 'bytea',
						tableName: 'full_history_ledger'
					},
					{
						columnName: 'transaction_hash',
						dataType: 'bytea',
						tableName: 'full_history_transaction'
					}
				])
			);
			expect(await copiedXdrColumns()).toEqual([]);
			expect(await bigintColumns()).toEqual([
				'checkpoint_ledger',
				'fee_bid',
				'fee_charged',
				'first_ledger',
				'last_ledger',
				'ledger_sequence',
				'ledger_sequence',
				'ledger_sequence',
				'next_ledger',
				'source_account_sequence'
			]);

			await migrator.startTransaction();
			await migration.down(migrator);
			await migrator.commitTransaction();
			expect(await canonicalRelations()).toEqual([]);
			expect(await sourceSnapshots()).toEqual(sourceBefore);
		} finally {
			if (migrator.isTransactionActive) await migrator.rollbackTransaction();
			if (blocker.isTransactionActive) await blocker.rollbackTransaction();
			await Promise.all([blocker.release(), migrator.release()]);
		}
	});

	async function sourceSnapshots(): Promise<Record<string, RelationSnapshot>> {
		return {
			history_archive_checkpoint_proof: await relationSnapshot(
				'history_archive_checkpoint_proof'
			),
			history_archive_object_queue: await relationSnapshot(
				'history_archive_object_queue'
			)
		};
	}

	async function relationSnapshot(table: string): Promise<RelationSnapshot> {
		if (!sourceTables.has(table)) throw new Error('Unexpected source table');
		const relation = (await dataSource.query(`
			select relfilenode::text as relfilenode,
				pg_relation_size(oid)::text as bytes
			from pg_class where oid = '${table}'::regclass
		`)) as Array<{ readonly bytes: string; readonly relfilenode: string }>;
		const rows = (await dataSource.query(
			`select ctid::text as ctid, xmin::text as xmin from "${table}" order by ctid`
		)) as Array<{ readonly ctid: string; readonly xmin: string }>;
		const snapshot = relation[0];
		if (snapshot === undefined) throw new Error(`Missing relation ${table}`);
		return { ...snapshot, rows };
	}

	async function canonicalRelations(): Promise<string[]> {
		const rows = (await dataSource.query(`
			select table_name as "tableName" from information_schema.tables
			where table_schema = 'public' and table_name like 'full_history_%'
			order by table_name
		`)) as Array<{ readonly tableName: string }>;
		return rows.map((row) => row.tableName);
	}

	async function canonicalRowCounts(): Promise<number[]> {
		const counts: number[] = [];
		for (const table of canonicalTables) {
			const rows = (await dataSource.query(
				`select count(*)::integer as count from "${table}"`
			)) as Array<{ readonly count: number }>;
			counts.push(rows[0]?.count ?? -1);
		}
		return counts;
	}

	async function hashColumnTypes(): Promise<unknown[]> {
		return dataSource.query(`
			select table_name as "tableName", column_name as "columnName",
				data_type as "dataType"
			from information_schema.columns
			where table_name like 'full_history_%'
				and (column_name like '%hash' or column_name like '%digest')
			order by table_name, column_name
		`);
	}

	async function copiedXdrColumns(): Promise<unknown[]> {
		return dataSource.query(`
			select column_name from information_schema.columns
			where table_name like 'full_history_%' and lower(column_name) like '%xdr%'
		`);
	}

	async function bigintColumns(): Promise<string[]> {
		const rows = (await dataSource.query(`
			select column_name as "columnName" from information_schema.columns
			where table_name like 'full_history_%' and data_type = 'bigint'
			order by column_name, table_name
		`)) as Array<{ readonly columnName: string }>;
		return rows.map((row) => row.columnName);
	}
});

const sourceTables = new Set([
	'history_archive_checkpoint_proof',
	'history_archive_object_queue'
]);

const canonicalTables = [
	'full_history_ingestion_batch',
	'full_history_ledger',
	'full_history_transaction',
	'full_history_transaction_result',
	'full_history_watermark'
] as const;
