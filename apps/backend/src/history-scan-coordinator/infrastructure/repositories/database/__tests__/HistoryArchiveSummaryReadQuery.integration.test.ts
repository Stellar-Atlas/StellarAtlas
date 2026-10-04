import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import {
	historyArchiveSummaryStatementTimeoutMs,
	queryHistoryArchiveSummary
} from '../HistoryArchiveSummaryReadQuery.js';

jest.setTimeout(60_000);

describe('archive summary database deadlines', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			type: 'postgres',
			url: postgres.url,
			extra: { max: 1 }
		});
		await dataSource.initialize();
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('returns exact values and restores pool settings after success', async () => {
		const rows = await queryHistoryArchiveSummary<{ count: string }>(
			dataSource.manager,
			'select $1::bigint::text as count',
			['9007199254740991']
		);
		expect(rows).toEqual([{ count: '9007199254740991' }]);
		expect(await dataSource.query('show statement_timeout')).toEqual([
			{ statement_timeout: '0' }
		]);
		expect(await dataSource.query('show lock_timeout')).toEqual([
			{ lock_timeout: '0' }
		]);
	});

	it('cancels a slow statement in PostgreSQL and releases the pooled connection', async () => {
		await expect(
			queryHistoryArchiveSummary(dataSource.manager, 'select pg_sleep($1)', [
				historyArchiveSummaryStatementTimeoutMs / 1000 + 5
			])
		).rejects.toMatchObject({ driverError: { code: '57014' } });
		expect(await dataSource.query('show statement_timeout')).toEqual([
			{ statement_timeout: '0' }
		]);
		expect(await dataSource.query('show lock_timeout')).toEqual([
			{ lock_timeout: '0' }
		]);
		expect(await dataSource.query('select 1 as healthy')).toEqual([
			{ healthy: 1 }
		]);
	});
});
