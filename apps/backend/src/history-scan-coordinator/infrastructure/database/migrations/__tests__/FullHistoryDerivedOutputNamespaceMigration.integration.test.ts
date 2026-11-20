import { DataSource, type MigrationInterface } from 'typeorm';
import { startDisposablePostgres, type DisposablePostgres } from '@test-support/DisposablePostgres.js';
import { FullHistoryDerivedOutputRetirementMigration1795125600000 } from '../FullHistoryDerivedOutputRetirementMigration1795125600000.js';
import { FullHistoryDerivedOutputNamespaceMigration1795146600000 } from '../FullHistoryDerivedOutputNamespaceMigration1795146600000.js';
import { readDerivedOutputRetirements } from '../../../full-history-ledger-close-meta/FullHistoryDerivedOutputRetirement.js';

jest.setTimeout(60_000);

describe('derived-output namespace migration', () => {
	let postgres: DisposablePostgres;
	let dataSource: DataSource;
	const oldMigration = new FullHistoryDerivedOutputRetirementMigration1795125600000();
	const migration = new FullHistoryDerivedOutputNamespaceMigration1795146600000();
	const legacy = '00000000-0000-4000-8000-000000000001';
	const current = '00000000-0000-4000-8000-000000000002';

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url,
			extra: { options: '-c statement_timeout=3000 -c lock_timeout=1000' } });
		await dataSource.initialize();
		await dataSource.query(`
			create table full_history_ledger_close_meta_batch (
				id uuid primary key, network_passphrase_hash bytea not null,
				start_ledger bigint not null, end_ledger bigint not null, processing_manifest_sha256 bytea not null
			);
			create table full_history_ledger_close_meta_dataset (
				batch_id uuid not null references full_history_ledger_close_meta_batch(id),
				dataset varchar(64) not null, representation varchar(64) not null,
				output_sha256 bytea not null, output_bytes bigint not null,
				record_count bigint not null, storage_key text not null, primary key(batch_id,dataset)
			)
		`);
		await apply(oldMigration, 'up');
		await seed(legacy);
		await dataSource.query(`update full_history_lcm_derived_output_retirement
			set removal_confirmed_at=clock_timestamp() where batch_id=$1`, [legacy]);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('preserves legacy authority and allows rollback only before namespace authority exists', async () => {
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await expect(migration.up(runner)).rejects.toThrow('active transaction');
		await runner.release();
		expect((await recovery(legacy)).version).toBe(1);
		await apply(migration, 'up');
		const [preserved] = await dataSource.query(`select
			removal_confirmed_at is not null as removed, namespace_removed_at,
			namespace_intent_sha256 from full_history_lcm_derived_output_retirement where batch_id=$1`, [legacy]);
		expect(preserved).toEqual({ removed: true, namespace_removed_at: null, namespace_intent_sha256: null });
		const legacyRecovery = await recovery(legacy);
		expect(legacyRecovery.version).toBe(2);
		expect(legacyRecovery.outputs[0]).toMatchObject({ removed: true, namespaceRemoved: false, namespaceIntentSha256: null });
		await apply(migration, 'down');
		const [columns] = await dataSource.query(`select count(*)::int as count from information_schema.columns
			where table_schema=current_schema() and table_name='full_history_lcm_derived_output_retirement'
			and column_name in ('namespace_removed_at','namespace_intent_sha256')`);
		expect(columns.count).toBe(0);
		await apply(migration, 'up');
	});

	it('enforces exact one-time namespace and physical transitions without granting namespace accounting credit', async () => {
		await seed(current);
		const update = (assignment: string, id = current) => dataSource.query(
			`update full_history_lcm_derived_output_retirement set ${assignment} where batch_id=$1`, [id]);
		await expect(update('removal_confirmed_at=clock_timestamp()')).rejects.toThrow('namespace removal must precede');
		await expect(update('namespace_removed_at=clock_timestamp()')).rejects.toThrow('exact namespace');
		await expect(update("namespace_removed_at=clock_timestamp(),namespace_intent_sha256=decode('aa','hex')"))
			.rejects.toThrow('exact namespace');
		await expect(update("namespace_removed_at=clock_timestamp(),namespace_intent_sha256=decode(repeat('aa',32),'hex'),removal_confirmed_at=clock_timestamp()"))
			.rejects.toThrow('record namespace removal before');
		await expect(update("evidence_sha256=decode(repeat('bb',32),'hex')")).rejects.toThrow('provenance is immutable');
		await update("namespace_removed_at=clock_timestamp(),namespace_intent_sha256=decode(repeat('aa',32),'hex')");
		const [namespaceOnly] = await dataSource.query(`select
			namespace_removed_at is not null as namespace, octet_length(namespace_intent_sha256) as intent_bytes,
			removal_confirmed_at is not null as removed from full_history_lcm_derived_output_retirement where batch_id=$1`, [current]);
		expect(namespaceOnly).toEqual({ namespace: true, intent_bytes: 32, removed: false });
		expect((await recovery(current)).outputs[0]).toMatchObject({
			removed: false, namespaceRemoved: true, namespaceIntentSha256: 'aa'.repeat(32)
		});
		await expect(update("namespace_removed_at=clock_timestamp(),namespace_intent_sha256=decode(repeat('bb',32),'hex')"))
			.rejects.toThrow('only one exact namespace');
		await expect(update('namespace_removed_at=null,namespace_intent_sha256=null')).rejects.toThrow('only one exact namespace');
		await expect(update("namespace_removed_at=clock_timestamp(),namespace_intent_sha256=decode(repeat('aa',32),'hex')", legacy))
			.rejects.toThrow('only one exact namespace');
		await expect(apply(migration, 'down')).rejects.toThrow('nonempty namespace recovery authority');
		await update('removal_confirmed_at=clock_timestamp()');
		await expect(update("removal_confirmed_at=removal_confirmed_at+interval '1 second'")).rejects.toThrow('only one physical');
		await expect(update('removal_confirmed_at=null')).rejects.toThrow('only one physical');
	});

	async function apply(value: MigrationInterface, direction: 'up' | 'down'): Promise<void> {
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		try {
			await value[direction](runner);
			await runner.commitTransaction();
		} catch (error) {
			await runner.rollbackTransaction();
			throw error;
		} finally {
			await runner.release();
		}
	}

	async function seed(id: string): Promise<void> {
		await dataSource.query(`insert into full_history_ledger_close_meta_batch
			values($1,decode(repeat('11',32),'hex'),3,66,decode(repeat('01',32),'hex'))`, [id]);
		await dataSource.query(`insert into full_history_ledger_close_meta_dataset values
			($1,'ledger-close-meta','lossless-replay',decode(repeat('02',32),'hex'),300,64,$2||'ledger-close-meta.xdr.zst'),
			($1,'transactions','typed-projection',decode(repeat('03',32),'hex'),123,7,$2||'transactions.parquet')`,
		[id, '11'.repeat(32) + '/ledger-close-meta/3-66/']);
		await dataSource.query(`insert into full_history_lcm_derived_output_retirement
			(batch_id,dataset,output_sha256,canonical_sha256,manifest_sha256,evidence_sha256,transform_revision)
			values($1,'transactions',decode(repeat('03',32),'hex'),decode(repeat('02',32),'hex'),
				decode(repeat('01',32),'hex'),decode(repeat('04',32),'hex'),repeat('a',40))`, [id]);
	}

	async function recovery(id: string) {
		const plans = await readDerivedOutputRetirements(dataSource, Buffer.alloc(32, 0x11), { batchIds: [id] });
		if (plans.length !== 1 || !plans[0]) throw new Error('missing fixture recovery');
		return plans[0];
	}
});
