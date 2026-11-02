import type { EntityManager } from 'typeorm';
import { mock } from 'jest-mock-extended';
import { admitGenericHistoryArchiveFrontier } from '../HistoryArchiveObjectExecutionReconciler.js';
import {
	historyArchiveObjectFrontierSql,
	seedHistoryArchiveFrontierCursorsSql
} from '../HistoryArchiveObjectFrontierSql.js';
import { historyArchivePerRootFrontier } from '../../../../domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';

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
		expectQuerySequence(manager, 'release');
	});

	it.each(['57014', '55P03'])(
		'keeps earlier canonical work committable on recoverable SQL state %s',
		async (code) => {
			const manager = mock<EntityManager>();
			const timeout = Object.assign(new Error('recoverable admission error'), {
				code
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
			expectQuerySequence(manager, 'rollback');
		}
	);

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
		expectQuerySequence(manager, 'rollback');
	});
});

function expectQuerySequence(
	manager: EntityManager,
	completion: 'release' | 'rollback'
): void {
	const release = ['release savepoint history_archive_generic_frontier'];
	const timeout = ["set local statement_timeout = '30s'"];
	expect(jest.mocked(manager.query).mock.calls).toEqual([
		['savepoint history_archive_generic_frontier'],
		timeout,
		[seedHistoryArchiveFrontierCursorsSql],
		[historyArchiveObjectFrontierSql, [12, historyArchivePerRootFrontier]],
		...(completion === 'release'
			? [release, timeout]
			: [['rollback to savepoint history_archive_generic_frontier'], release])
	]);
}
