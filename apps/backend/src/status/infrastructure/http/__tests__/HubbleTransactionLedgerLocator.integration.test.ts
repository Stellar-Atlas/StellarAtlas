import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import {
	createPostgresHubbleTransactionLedgerLocator,
	withBoundedHubbleTransactionLocatorRead
} from '../HubbleTransactionLedgerLocator.js';

jest.setTimeout(45000);
describe('bounded indexed transaction ledger metadata', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	const hash = 'a'.repeat(64);
	const networkHash = (network: string) =>
		createHash('sha256').update(network).digest();
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await new DataSource({
			type: 'postgres',
			url: postgres.url,
			extra: { max: 1, connectionTimeoutMillis: 1000 }
		}).initialize();
		await db.query(
			'create table full_history_transaction (network_passphrase_hash bytea, transaction_hash bytea, ledger_sequence bigint, primary key (network_passphrase_hash, transaction_hash))'
		);
		await db.query(
			'insert into full_history_transaction values ($1,$2,63490364),($3,$2,123),($1,$4,999999999999)',
			[
				networkHash('network A'),
				Buffer.from(hash, 'hex'),
				networkHash('network B'),
				Buffer.alloc(32, 0)
			]
		);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	it('selects only the exact hash on the configured network and rejects absent or unusable hints', async () => {
		const locate = createPostgresHubbleTransactionLedgerLocator(
			db,
			'network A'
		);
		expect(await locate(hash.toUpperCase())).toBe(63490364);
		expect(
			await createPostgresHubbleTransactionLedgerLocator(db, 'network B')(hash)
		).toBe(123);
		expect(await locate('b'.repeat(64))).toBeNull();
		expect(await locate('0'.repeat(64))).toBeNull();
		await expect(locate('invalid')).rejects.toThrow('transactionHash');
	});
	it('sets transaction-local read-only, statement and lock bounds', async () => {
		const rows = await withBoundedHubbleTransactionLocatorRead(db, (manager) =>
			manager.query(
				"select current_setting('statement_timeout') as timeout, current_setting('lock_timeout') as lock, current_setting('transaction_read_only') as readonly, current_setting('transaction_isolation') as isolation"
			)
		);
		expect(rows).toEqual([
			{
				timeout: '750ms',
				lock: '100ms',
				readonly: 'on',
				isolation: 'read committed'
			}
		]);
	});
	it('cancels a slow statement in PostgreSQL and releases the sole connection with settings restored', async () => {
		await expect(
			withBoundedHubbleTransactionLocatorRead(db, (manager) =>
				manager.query('select pg_sleep(2)')
			)
		).rejects.toMatchObject({ driverError: { code: '57014' } });
		expect(
			await db.query(
				"select current_setting('statement_timeout') as timeout, current_setting('lock_timeout') as lock, current_setting('transaction_read_only') as readonly"
			)
		).toEqual([{ timeout: '0', lock: '0', readonly: 'off' }]);
		expect(
			await createPostgresHubbleTransactionLedgerLocator(db, 'network A')(hash)
		).toBe(63490364);
	});
	it('rejects writes and still releases the pooled connection', async () => {
		await expect(
			withBoundedHubbleTransactionLocatorRead(db, (manager) =>
				manager.query('delete from full_history_transaction')
			)
		).rejects.toMatchObject({ driverError: { code: '25006' } });
		expect(
			await createPostgresHubbleTransactionLedgerLocator(db, 'network A')(hash)
		).toBe(63490364);
	});
});
