import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { FullHistoryLedgerCloseMetaStateImportMigration1785130000000 } from '../../../database/migrations/1785130000000-FullHistoryLedgerCloseMetaStateImportMigration.js';
import { checkFullHistoryStateImportReadiness } from '../FullHistoryStateImportReadiness.js';

jest.setTimeout(60_000);

describe('full-history state-import readiness integration', () => {
	let dataSource: DataSource;
	let executablePath: string;
	let postgres: DisposablePostgres;
	let runtimeRoot: string;
	let storageRoot: string;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			logging: false,
			migrations: [FullHistoryLedgerCloseMetaStateImportMigration1785130000000],
			migrationsRun: false,
			synchronize: false,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		await installUpstreamSchema(dataSource);
		runtimeRoot = await mkdtemp(join(tmpdir(), 'state-import-schema-'));
		storageRoot = join(runtimeRoot, 'typed');
		executablePath = join(runtimeRoot, 'exporter');
		await mkdir(storageRoot);
		await writeFile(executablePath, 'test executable');
		await chmod(executablePath, 0o700);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
		if (runtimeRoot !== undefined) {
			await rm(runtimeRoot, { force: true, recursive: true });
		}
	});

	it('requires migration 178513 and detects later claim-index drift', async () => {
		const paths = { executablePath, storageRoot };
		const before = await checkFullHistoryStateImportReadiness(
			dataSource,
			paths
		);
		expect(before.pendingMigrations).toBe(true);
		expect(before.ready).toBe(false);
		expect(before.missingSchemaObjects).toContain(
			'relation:full_history_lcm_state_import'
		);

		await dataSource.runMigrations({ transaction: 'each' });
		await expect(
			checkFullHistoryStateImportReadiness(dataSource, paths)
		).resolves.toEqual({
			missingRuntimeObjects: [],
			missingSchemaObjects: [],
			pendingMigrations: false,
			ready: true
		});

		await dataSource.query(
			'drop index "idx_full_history_lcm_state_import_claim"'
		);
		const drifted = await checkFullHistoryStateImportReadiness(
			dataSource,
			paths
		);
		expect(drifted.ready).toBe(false);
		expect(drifted.missingSchemaObjects).toEqual([
			'index:full_history_lcm_state_import.idx_full_history_lcm_state_import_claim'
		]);
	});
});

async function installUpstreamSchema(dataSource: DataSource): Promise<void> {
	await dataSource.query(`
		create table "full_history_ledger_close_meta_batch" (
			"id" uuid not null primary key,
			"start_ledger" bigint not null,
			"end_ledger" bigint not null
		);
		create table "full_history_ledger_close_meta_dataset" (
			"batch_id" uuid not null,
			"dataset" text not null,
			"storage_key" text not null,
			"output_sha256" bytea not null,
			"record_count" bigint not null
		)
	`);
}
