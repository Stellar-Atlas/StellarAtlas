import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { withBoundedArchiveEvidenceRead } from '../BoundedArchiveEvidenceRead.js';
import { withBoundedArchiveBrokerMaintenance } from '../BoundedArchiveBrokerMaintenance.js';
import { ArchiveEvidenceReadModelUnavailableError } from '../../../../domain/known-archive-evidence/ArchiveEvidenceReadModelUnavailableError.js';

jest.setTimeout(45_000);

describe('bounded archive read and optional broker maintenance transactions', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await new DataSource({
			type: 'postgres',
			url: postgres.url,
			extra: { max: 1, connectionTimeoutMillis: 1000 }
		}).initialize();
		await db.query(
			'create table bounded_archive_fixture (id integer primary key)'
		);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	it('uses a read-only snapshot with a local 5s bound and returns rows unchanged', async () => {
		const rows = await withBoundedArchiveEvidenceRead(db, (manager) =>
			manager.query(`
			select current_setting('statement_timeout') as timeout,
			current_setting('transaction_read_only') as readonly,
			current_setting('transaction_isolation') as isolation, 42 as value
		`)
		);
		expect(rows).toEqual([
			{ timeout: '5s', readonly: 'on', isolation: 'repeatable read', value: 42 }
		]);
	});
	it('cancels an excessive read, rolls back and releases the only pooled connection', async () => {
		await expect(
			withBoundedArchiveEvidenceRead(db, (manager) =>
				manager.query('select pg_sleep(6)')
			)
		).rejects.toBeInstanceOf(ArchiveEvidenceReadModelUnavailableError);
		expect(
			await db.query(
				"select current_setting('statement_timeout') as timeout, 42 as value"
			)
		).toEqual([{ timeout: '0', value: 42 }]);
	});
	it('rejects writes and propagates non-timeout errors without corrupting pooled state', async () => {
		await expect(
			withBoundedArchiveEvidenceRead(db, (manager) =>
				manager.query('insert into bounded_archive_fixture values (1)')
			)
		).rejects.toMatchObject({ driverError: { code: '25006' } });
		expect(await db.query('select * from bounded_archive_fixture')).toEqual([]);
	});
	it('bounds only optional broker maintenance, rolls back partial work and returns to dispatch', async () => {
		const result = await withBoundedArchiveBrokerMaintenance(
			db,
			async (manager) => {
				const settings = await manager.query(
					"select current_setting('statement_timeout') as timeout, current_setting('lock_timeout') as lock, current_setting('jit') as jit"
				);
				expect(settings).toEqual([
					{ timeout: '2s', lock: '250ms', jit: 'off' }
				]);
				await manager.query('insert into bounded_archive_fixture values (2)');
				await manager.query('select pg_sleep(3)');
				return 1;
			},
			0
		);
		expect(result).toBe(0);
		expect(await db.query('select * from bounded_archive_fixture')).toEqual([]);
		expect(
			await db.query("select current_setting('statement_timeout') as timeout")
		).toEqual([{ timeout: '0' }]);
		const recovered = await withBoundedArchiveBrokerMaintenance(
			db,
			async (manager) => {
				await manager.query('insert into bounded_archive_fixture values (3)');
				return 1;
			},
			0
		);
		expect(recovered).toBe(1);
		expect(await db.query('select * from bounded_archive_fixture')).toEqual([
			{ id: 3 }
		]);
	});
	it('does not swallow unexpected broker maintenance failures', async () => {
		await expect(
			withBoundedArchiveBrokerMaintenance(
				db,
				(manager) => manager.query('select definitely_missing_column'),
				0
			)
		).rejects.toMatchObject({ driverError: { code: '42703' } });
	});
});
