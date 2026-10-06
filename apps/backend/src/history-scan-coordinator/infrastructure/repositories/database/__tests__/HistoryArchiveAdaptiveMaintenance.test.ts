import type { DataSource, EntityManager } from 'typeorm';
import { HistoryArchiveBrokerFrontierRepository } from '../HistoryArchiveBrokerFrontierRepository.js';

describe('adaptive maintenance transaction and cadence', () => {
	afterEach(() => jest.restoreAllMocks());
	it('keeps the one-second cadence and returns only the committed result', async () => {
		const clock = jest.spyOn(Date, 'now').mockReturnValue(100_000);
		const transaction = jest
			.fn()
			.mockResolvedValueOnce([{}, {}, {}])
			.mockResolvedValueOnce(1)
			.mockResolvedValueOnce(1)
			.mockResolvedValueOnce(1)
			.mockResolvedValueOnce([{}, {}, {}])
			.mockResolvedValueOnce(1)
			.mockResolvedValueOnce(1)
			.mockResolvedValueOnce(1);
		const repository = new HistoryArchiveBrokerFrontierRepository({
			transaction
		} as unknown as DataSource);
		await expect(repository.maintainAdaptiveProbes(120)).resolves.toBe(3);
		clock.mockReturnValue(100_999);
		await expect(repository.maintainAdaptiveProbes(120)).resolves.toBe(0);
		clock.mockReturnValue(101_000);
		await expect(repository.maintainAdaptiveProbes(120)).resolves.toBe(3);
		expect(transaction).toHaveBeenCalledTimes(8);
	});
	it.each(['57014', '55P03', '40P01', 'CONNECTION_FAILURE'])(
		'fails open and backs off 60 seconds after %s',
		async (code) => {
			const clock = jest.spyOn(Date, 'now').mockReturnValue(100_000);
			const transaction = jest.fn().mockRejectedValue({ code });
			const repository = new HistoryArchiveBrokerFrontierRepository({
				transaction
			} as unknown as DataSource);
			await expect(repository.maintainAdaptiveProbes(120)).resolves.toBe(0);
			clock.mockReturnValue(159_999);
			await expect(repository.maintainAdaptiveProbes(120)).resolves.toBe(0);
			expect(transaction).toHaveBeenCalledTimes(1);
			clock.mockReturnValue(160_000);
			await expect(repository.maintainAdaptiveProbes(120)).resolves.toBe(0);
			expect(transaction).toHaveBeenCalledTimes(2);
		}
	);
	it('retains its independent transaction bounds and sixteen-root cap', async () => {
		const query = jest.fn().mockResolvedValue([]);
		const manager = { query } as unknown as EntityManager;
		const transaction = jest.fn(
			async (work: (manager: EntityManager) => Promise<number>) => work(manager)
		);
		const repository = new HistoryArchiveBrokerFrontierRepository({
			transaction
		} as unknown as DataSource);
		await expect(repository.maintainAdaptiveProbes(120)).resolves.toBe(0);
		expect(query).toHaveBeenNthCalledWith(
			1,
			"set local statement_timeout = '2s'; set local lock_timeout = '250ms'; set local jit = off"
		);
		expect(query).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining('history_archive_root_failure_control'),
			[16, ['checkpoint-state', 'ledger', 'transactions', 'results', 'scp']]
		);
		expect(transaction).toHaveBeenCalledTimes(1);
	});
	it('does not run adaptive work inside a reservation', async () => {
		const query = jest.fn().mockResolvedValue([]);
		const manager = { query } as unknown as EntityManager;
		const transaction = jest.fn(
			async (work: (manager: EntityManager) => Promise<unknown>) =>
				work(manager)
		);
		const repository = new HistoryArchiveBrokerFrontierRepository({
			transaction
		} as unknown as DataSource);
		const adaptive = jest.spyOn(repository, 'maintainAdaptiveProbes');
		await expect(repository.reserveJobs(1, 8)).resolves.toEqual([]);
		expect(adaptive).not.toHaveBeenCalled();
	});
	it('does not open a transaction without capacity', async () => {
		const transaction = jest.fn();
		const repository = new HistoryArchiveBrokerFrontierRepository({
			transaction
		} as unknown as DataSource);
		await expect(repository.maintainAdaptiveProbes(0)).resolves.toBe(0);
		expect(transaction).not.toHaveBeenCalled();
	});
});
