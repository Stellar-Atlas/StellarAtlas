import type { EntityManager } from 'typeorm';
import {
	enqueueHistoryArchiveReadyObjects,
	synchronizeHistoryArchiveReadyQueue
} from '../HistoryArchiveObjectReadyQueue.js';

describe('HistoryArchiveObjectReadyQueue', () => {
	it('skips a maintenance refill while another frontier writer owns the lock', async () => {
		const query = jest.fn().mockResolvedValue([{ locked: false }]);
		const manager = { query } as unknown as EntityManager;

		await expect(
			synchronizeHistoryArchiveReadyQueue(manager, 96)
		).resolves.toEqual({
			readyObjects: 0,
			removedObjects: 0,
			scheduledObjects: 0
		});

		expect(query).toHaveBeenCalledTimes(1);
	});

	it('skips eager enqueue when the reconciliation writer owns the frontier', async () => {
		const query = jest.fn().mockResolvedValue([{ count: 0 }]);
		const manager = { query } as unknown as EntityManager;

		await expect(
			enqueueHistoryArchiveReadyObjects(manager, [
				'00000000-0000-4000-8000-000000000001'
			])
		).resolves.toBe(0);

		expect(query).toHaveBeenCalledTimes(1);
		expect(query.mock.calls[0]?.[0]).toContain('pg_try_advisory_xact_lock');
	});

	it('enqueues immediately while holding the exclusive reconciliation gate', async () => {
		const query = jest.fn().mockResolvedValue([{ count: 3 }]);
		const manager = { query } as unknown as EntityManager;

		await expect(
			enqueueHistoryArchiveReadyObjects(manager, [
				'00000000-0000-4000-8000-000000000001'
			])
		).resolves.toBe(3);

		expect(query).toHaveBeenCalledTimes(1);
		expect(query.mock.calls[0]?.[1]).toEqual([
			['00000000-0000-4000-8000-000000000001'],
			[],
			expect.any(String)
		]);
	});
});
