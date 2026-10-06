import { DataSource, type EntityManager } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveBrokerFrontierRepository } from '../HistoryArchiveBrokerFrontierRepository.js';

jest.setTimeout(30_000);
describe('reservation-local memory budget', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = new DataSource({
			type: 'postgres',
			url: postgres.url,
			extra: { max: 1 }
		});
		await db.initialize();
		await db.query("set work_mem='8MB'");
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	it.each([false, true])(
		'sets memory after the mutex and restores pooled session on completion (error=%s)',
		async (error) => {
			const observed: string[] = [];
			const settings: string[] = [];
			const transaction = async <T>(
				work: (manager: EntityManager) => Promise<T>
			) =>
				db.transaction(async (manager) => {
					const execute = manager.query.bind(manager);
					const query = async (sql: string, parameters?: unknown[]) => {
						observed.push(sql);
						if (sql.includes('from retry_budgeted candidate')) {
							const [row] = await execute('show work_mem');
							settings.push(row.work_mem);
							if (error) return execute('select 1/0');
							return [];
						}
						return execute(sql, parameters);
					};
					return work(
						new Proxy(manager, {
							get: (target, property, receiver) =>
								property === 'query'
									? query
									: Reflect.get(target, property, receiver)
						})
					);
				});
			const repository = new HistoryArchiveBrokerFrontierRepository({
				transaction
			} as unknown as DataSource);
			if (error)
				await expect(repository.reserveJobs(1, 8)).rejects.toMatchObject({
					driverError: { code: '22012' }
				});
			else await expect(repository.reserveJobs(1, 8)).resolves.toEqual([]);
			expect(observed[0]).toContain('pg_advisory_xact_lock');
			expect(observed[1]).toBe("set local work_mem = '32MB'");
			expect(observed[2]).toContain('from retry_budgeted candidate');
			expect(settings).toEqual(['32MB']);
			expect(await db.query('show work_mem')).toEqual([{ work_mem: '8MB' }]);
		}
	);
	it('does not set memory or start a transaction without capacity', async () => {
		const transaction = jest.fn();
		const repository = new HistoryArchiveBrokerFrontierRepository({
			transaction
		} as unknown as DataSource);
		await expect(repository.reserveJobs(0, 8)).resolves.toEqual([]);
		expect(transaction).not.toHaveBeenCalled();
		expect(await db.query('show work_mem')).toEqual([{ work_mem: '8MB' }]);
	});
	it('does not allocate the reservation budget when mutex acquisition fails', async () => {
		const query = jest.fn().mockRejectedValue(new Error('mutex unavailable'));
		const transaction = async <T>(
			work: (manager: EntityManager) => Promise<T>
		) => work({ query } as unknown as EntityManager);
		const repository = new HistoryArchiveBrokerFrontierRepository({
			transaction
		} as unknown as DataSource);
		await expect(repository.reserveJobs(1, 8)).rejects.toThrow(
			'mutex unavailable'
		);
		expect(query).toHaveBeenCalledTimes(1);
		expect(query.mock.calls[0]?.[0]).toContain('pg_advisory_xact_lock');
	});
});
