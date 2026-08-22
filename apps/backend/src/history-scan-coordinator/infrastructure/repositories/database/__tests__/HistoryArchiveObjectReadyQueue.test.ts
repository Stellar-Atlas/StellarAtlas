import type { EntityManager } from 'typeorm';
import { enqueueHistoryArchiveReadyObjects } from '../HistoryArchiveObjectReadyQueue.js';

describe('HistoryArchiveObjectReadyQueue', () => {
	it('skips eager enqueue when the reconciliation writer owns the frontier', async () => {
		const query = jest.fn().mockResolvedValue([{ locked: false }]);
		const manager = { query } as unknown as EntityManager;

		await expect(
			enqueueHistoryArchiveReadyObjects(manager, [
				'00000000-0000-4000-8000-000000000001'
			])
		).resolves.toBe(0);

		expect(query).toHaveBeenCalledTimes(1);
		expect(query.mock.calls[0]?.[0]).toContain(
			'pg_try_advisory_xact_lock_shared'
		);
	});

	it('enqueues immediately while holding the shared reconciliation gate', async () => {
		const query = jest
			.fn()
			.mockResolvedValueOnce([{ locked: true }])
			.mockResolvedValueOnce([{ count: 3 }]);
		const manager = { query } as unknown as EntityManager;

		await expect(
			enqueueHistoryArchiveReadyObjects(manager, [
				'00000000-0000-4000-8000-000000000001'
			])
		).resolves.toBe(3);

		expect(query).toHaveBeenCalledTimes(2);
		expect(query.mock.calls[1]?.[1]).toEqual([
			['00000000-0000-4000-8000-000000000001'],
			[]
		]);
	});
});
