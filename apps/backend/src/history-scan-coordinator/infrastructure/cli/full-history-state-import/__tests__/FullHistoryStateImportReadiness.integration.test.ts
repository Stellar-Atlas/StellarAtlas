import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { installFullHistoryPrerequisites } from '../../../database/full-history/__tests__/FullHistoryCanonicalFixture.js';
import { FullHistoryCanonicalSchemaMigration1784860000000 } from '../../../database/migrations/1784860000000-FullHistoryCanonicalSchemaMigration.js';
import { FullHistoryLedgerCloseMetaStateImportMigration1785130000000 } from '../../../database/migrations/1785130000000-FullHistoryLedgerCloseMetaStateImportMigration.js';
import { FullHistoryLedgerCloseMetaCanonicalCoverageMigration1785140000000 } from '../../../database/migrations/1785140000000-FullHistoryLedgerCloseMetaCanonicalCoverageMigration.js';
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
			migrations: [
				FullHistoryLedgerCloseMetaStateImportMigration1785130000000,
				FullHistoryLedgerCloseMetaCanonicalCoverageMigration1785140000000
			],
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

	it('requires migrations 178513-178514 and detects later claim-index drift', async () => {
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
	const runner = dataSource.createQueryRunner();
	await runner.connect();
	await runner.startTransaction();
	try {
		await installFullHistoryPrerequisites(runner);
		await new FullHistoryCanonicalSchemaMigration1784860000000().up(runner);
		await runner.commitTransaction();
	} catch (error) {
		await runner.rollbackTransaction();
		throw error;
	} finally {
		await runner.release();
	}
	await dataSource.query(`
		create table "full_history_ledger_close_meta_batch" (
			"id" uuid not null primary key,
			"network_passphrase_hash" bytea not null,
			"start_ledger" bigint not null,
			"end_ledger" bigint not null,
			"ledger_count" integer not null,
			unique ("id", "network_passphrase_hash")
		);
		create table "full_history_ledger_close_meta_dataset" (
			"batch_id" uuid not null,
			"dataset" text not null,
			"storage_key" text not null,
			"output_sha256" bytea not null,
			"record_count" bigint not null,
			primary key ("batch_id", "dataset")
		);
	`);
}
