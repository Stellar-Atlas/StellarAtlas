import type { EntityManager } from 'typeorm';
import { mock } from 'jest-mock-extended';
import { admitGenericHistoryArchiveFrontier } from '../HistoryArchiveObjectExecutionReconciler.js';

describe('generic archive frontier admission', () => {
	it('returns the admitted counts and restores the reconciliation timeout', async () => {
		const manager = mock<EntityManager>();
		manager.query
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ admittedObjects: 2, cursorAdvances: 7 }])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		await expect(
			admitGenericHistoryArchiveFrontier(manager, 12)
		).resolves.toEqual({ admittedObjects: 2, cursorAdvances: 7 });
		expect(queryText(manager)).toEqual(
			expect.arrayContaining([
				"set local statement_timeout = '5s'",
				"set local statement_timeout = '30s'"
			])
		);
	});

	it('keeps earlier canonical work committable when the generic query times out', async () => {
		const manager = mock<EntityManager>();
		const timeout = Object.assign(new Error('statement timeout'), {
			code: '57014'
		});
		manager.query
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockRejectedValueOnce(timeout)
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		await expect(
			admitGenericHistoryArchiveFrontier(manager, 12)
		).resolves.toBeUndefined();
		expect(queryText(manager)).toEqual(
			expect.arrayContaining([
				'rollback to savepoint history_archive_generic_frontier',
				'release savepoint history_archive_generic_frontier'
			])
		);
	});

	it('restores the transaction and rethrows an unexpected database error', async () => {
		const manager = mock<EntityManager>();
		const failure = new Error('unexpected failure');
		manager.query
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		await expect(admitGenericHistoryArchiveFrontier(manager, 12)).rejects.toBe(
			failure
		);
		expect(queryText(manager)).toContain(
			'rollback to savepoint history_archive_generic_frontier'
		);
	});
});

function queryText(manager: EntityManager): readonly string[] {
	return jest.mocked(manager.query).mock.calls.map(([sql]) => sql.trim());
}
