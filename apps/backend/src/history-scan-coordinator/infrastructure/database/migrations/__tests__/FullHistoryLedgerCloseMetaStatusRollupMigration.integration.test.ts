import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { FullHistoryLedgerCloseMetaStatusRollupMigration1785220000000 } from '../1785220000000-FullHistoryLedgerCloseMetaStatusRollupMigration.js';

jest.setTimeout(60_000);

describe('FullHistoryLedgerCloseMetaStatusRollupMigration integration', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	const networkHash = Buffer.alloc(32, 7);

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
		await dataSource.query(`
			create table "full_history_ledger_close_meta_dataset" (
				"network_passphrase_hash" bytea not null,
				"dataset" varchar(64) not null,
				"schema_version" varchar(64) not null,
				"record_count" bigint not null,
				"output_bytes" bigint not null
			)
		`);
		await insertDataset('transactions', '3', 10, 100);
		await insertDataset('transactions', '3', 20, 200);
		await insertDataset('transactions', '4', 30, 300);
		const queryRunner = dataSource.createQueryRunner();
		await new FullHistoryLedgerCloseMetaStatusRollupMigration1785220000000().up(
			queryRunner
		);
		await queryRunner.release();
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('backfills existing rows and increments totals after later inserts', async () => {
		await expect(readTotals()).resolves.toEqual([
			{ batchCount: '2', outputBytes: '300', recordCount: '30', version: '3' },
			{ batchCount: '1', outputBytes: '300', recordCount: '30', version: '4' }
		]);

		await insertDataset('transactions', '3', 40, 400);

		await expect(readTotals()).resolves.toEqual([
			{ batchCount: '3', outputBytes: '700', recordCount: '70', version: '3' },
			{ batchCount: '1', outputBytes: '300', recordCount: '30', version: '4' }
		]);
	});

	async function insertDataset(
		dataset: string,
		version: string,
		recordCount: number,
		outputBytes: number
	): Promise<void> {
		await dataSource.query(
			`insert into "full_history_ledger_close_meta_dataset" (
				"network_passphrase_hash", "dataset", "schema_version",
				"record_count", "output_bytes"
			 ) values ($1, $2, $3, $4, $5)`,
			[networkHash, dataset, version, recordCount, outputBytes]
		);
	}

	async function readTotals(): Promise<readonly RollupRow[]> {
		return await dataSource.query<RollupRow[]>(
			`select "schema_version" as version,
				"batch_count"::text as "batchCount",
				"record_count"::text as "recordCount",
				"output_bytes"::text as "outputBytes"
			 from "full_history_lcm_dataset_status_rollup"
			 where "network_passphrase_hash" = $1 and "dataset" = 'transactions'
			 order by "schema_version"`,
			[networkHash]
		);
	}
});

interface RollupRow {
	readonly batchCount: string;
	readonly outputBytes: string;
	readonly recordCount: string;
	readonly version: string;
}
