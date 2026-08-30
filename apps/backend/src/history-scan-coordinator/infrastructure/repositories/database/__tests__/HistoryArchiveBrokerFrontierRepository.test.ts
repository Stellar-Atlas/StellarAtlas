import type { DataSource, EntityManager } from 'typeorm';
import {
	HistoryArchiveBrokerFrontierRepository,
	reserveBrokerJobsSql
} from '../HistoryArchiveBrokerFrontierRepository.js';
import { historyArchiveExecutionReconciliationLockName } from '../HistoryArchiveObjectExecutionReconciler.js';

describe('HistoryArchiveBrokerFrontierRepository', () => {
	it('admits independent ready objects without deleting a competing priority lane', () => {
		expect(reserveBrokerJobsSql).toContain('from eligible candidate');
		expect(reserveBrokerJobsSql).toContain(
			'ranked.active_count + ranked.host_rank <= $2::integer'
		);
		expect(reserveBrokerJobsSql).not.toContain('frozen_lane');
		expect(reserveBrokerJobsSql).not.toContain('deduplicated as materialized');
		expect(reserveBrokerJobsSql).not.toContain('displaced as');
		expect(reserveBrokerJobsSql).not.toContain('displacement_fence');
	});

	it('skips ready rows already locked by a terminal completion', () => {
		expect(reserveBrokerJobsSql).toContain('lockable as materialized');
		expect(reserveBrokerJobsSql).toContain('for update of ready skip locked');
		expect(reserveBrokerJobsSql).toContain(
			'and ready."objectRemoteId" = lockable."objectRemoteId"'
		);
	});

	it('marks broker reservations published inside the reservation transaction', () => {
		expect(reserveBrokerJobsSql).toContain('"publishedAt" = now()');
		expect(reserveBrokerJobsSql).toContain('"updatedAt" = now()');
	});

	it('resets failed publishes in checkpoint fan-out lock order', async () => {
		const query = jest.fn().mockResolvedValue([]);
		const manager = { query } as unknown as EntityManager;
		const transaction = jest.fn(
			async (work: (manager: EntityManager) => Promise<void>) =>
				await work(manager)
		);
		const repository = new HistoryArchiveBrokerFrontierRepository({
			transaction
		} as unknown as DataSource);

		await repository.resetPublished(['00000000-0000-0000-0000-000000000001']);
		const sql = query.mock.calls[0]?.[0] as string;
		expect(sql).toContain('failed_publish as materialized');
		expect(sql.replace(/\s+/g, ' ')).toContain(
			'order by ready."archiveUrlIdentity", ready."objectRemoteId"'
		);
		expect(sql).toContain('for update of ready');
		expect(sql).toContain('set "publishedAt" = null');
	});

	it('skips frontier reconciliation instead of queueing an exclusive lock', async () => {
		const query = jest.fn().mockResolvedValue([{ locked: false }]);
		const manager = { query } as unknown as EntityManager;
		const transaction = jest.fn(
			async (work: (manager: EntityManager) => Promise<number>) =>
				await work(manager)
		);
		const repository = new HistoryArchiveBrokerFrontierRepository({
			transaction
		} as unknown as DataSource);

		await expect(repository.ensureFrontier()).resolves.toBe(0);
		expect(query).toHaveBeenCalledTimes(1);
		expect(query).toHaveBeenCalledWith(
			expect.stringContaining('pg_try_advisory_xact_lock'),
			[historyArchiveExecutionReconciliationLockName]
		);
	});
});
