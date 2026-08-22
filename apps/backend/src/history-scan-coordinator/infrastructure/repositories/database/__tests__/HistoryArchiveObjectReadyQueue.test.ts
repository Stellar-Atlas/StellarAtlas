import type { EntityManager } from 'typeorm';
import { synchronizeHistoryArchiveReadyQueue } from '../HistoryArchiveObjectReadyQueue.js';

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
});
