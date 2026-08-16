import type { EntityManager } from 'typeorm';
import { advanceOperationAccountReferenceProgress } from '../FullHistoryOperationProjectionProgressStore.js';

const batchId = '00000000-0000-4000-8000-000000000001';

describe('FullHistoryOperationProjectionProgressStore', () => {
	it('uses a top-level select so TypeORM returns rows for a successful CAS', async () => {
		const query = jest
			.fn()
			.mockResolvedValue([{ nextOffset: 1_000, updatedCount: 1 }]);

		await expect(
			advanceOperationAccountReferenceProgress(
				{ query } as unknown as EntityManager,
				batchId,
				500,
				1_000
			)
		).resolves.toBeUndefined();

		expect(query).toHaveBeenCalledWith(
			expect.stringMatching(/^with updated as \(/),
			[batchId, 'operation-account-reference', 500, 1_000]
		);
		expect(query.mock.calls[0]?.[0]).toContain(
			'select count(*)::integer as "updatedCount"'
		);
	});

	it('rejects a compare-and-swap that did not update exactly one row', async () => {
		const query = jest
			.fn()
			.mockResolvedValue([{ nextOffset: null, updatedCount: 0 }]);

		await expect(
			advanceOperationAccountReferenceProgress(
				{ query } as unknown as EntityManager,
				batchId,
				500,
				1_000
			)
		).rejects.toMatchObject({
			reason: 'canonical-row-conflict',
			message: 'Operation account-reference progress changed concurrently'
		});
	});
});
