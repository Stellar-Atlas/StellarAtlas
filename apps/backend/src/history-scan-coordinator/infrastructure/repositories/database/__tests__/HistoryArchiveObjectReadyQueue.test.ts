import type { EntityManager } from 'typeorm';
import {
	removeCompletedHistoryArchiveBrokerReadyRow,
	synchronizeHistoryArchiveReadyQueue
} from '../HistoryArchiveObjectReadyQueue.js';

describe('HistoryArchiveObjectReadyQueue', () => {
	it('skips a maintenance refill while another frontier writer owns the lock', async () => {
		const query = jest.fn().mockResolvedValue([{ locked: false }]);
		const manager = {
			query,
			queryRunner: { isTransactionActive: true }
		} as unknown as EntityManager;

		await expect(
			synchronizeHistoryArchiveReadyQueue(manager, 96)
		).resolves.toEqual({
			readyObjects: 0,
			removedObjects: 0,
			scheduledObjects: 0
		});

		expect(query).toHaveBeenCalledTimes(1);
	});

	it('keeps the writer lock and refill in one transaction', async () => {
		const query = jest.fn().mockResolvedValue([{ locked: false }]);
		const transactionManager = {
			query,
			queryRunner: { isTransactionActive: true }
		} as unknown as EntityManager;
		const transaction = jest.fn(
			async (
				callback: (manager: EntityManager) => Promise<unknown>
			): Promise<unknown> => await callback(transactionManager)
		);
		const manager = { transaction } as unknown as EntityManager;

		await synchronizeHistoryArchiveReadyQueue(manager, 96);

		expect(transaction).toHaveBeenCalledTimes(1);
		expect(query).toHaveBeenCalledTimes(1);
	});

	it('removes only the completed broker execution row', async () => {
		const query = jest.fn().mockResolvedValue([]);
		const manager = { query } as unknown as EntityManager;
		const remoteId = '00000000-0000-4000-8000-000000000001';
		const executionId = '00000000-0000-4000-8000-000000000002';

		await removeCompletedHistoryArchiveBrokerReadyRow(
			manager,
			remoteId,
			executionId,
			3
		);

		expect(query).toHaveBeenCalledWith(
			expect.stringContaining('delete from "history_archive_object_ready"'),
			[remoteId, executionId, 3]
		);
	});
});
