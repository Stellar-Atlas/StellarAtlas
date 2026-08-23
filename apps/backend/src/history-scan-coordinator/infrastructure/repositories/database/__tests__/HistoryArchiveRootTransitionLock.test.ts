import type { EntityManager } from 'typeorm';
import {
	historyArchiveObjectRootTransitionLockSql,
	historyArchiveRootTransitionLockSql,
	lockHistoryArchiveObjectRootTransition,
	lockHistoryArchiveRootTransition
} from '../HistoryArchiveRootTransitionLock.js';

describe('HistoryArchiveRootTransitionLock', () => {
	it('uses the same per-root advisory-lock namespace as archive summaries', () => {
		expect(historyArchiveRootTransitionLockSql).toContain('1784950001');
		expect(historyArchiveRootTransitionLockSql).toContain('hashtext($1::text)');
		expect(historyArchiveObjectRootTransitionLockSql).toContain('1784950001');
		expect(historyArchiveObjectRootTransitionLockSql).toContain(
			'hashtext(object."archiveUrlIdentity")'
		);
		expect(historyArchiveObjectRootTransitionLockSql).toContain(
			'object."objectType" in'
		);
		expect(historyArchiveObjectRootTransitionLockSql).toContain("'checkpoint-state'");
	});

	it('locks a known root before a proof transition', async () => {
		const query = jest.fn().mockResolvedValue([]);
		const manager = { query } as unknown as EntityManager;

		await lockHistoryArchiveRootTransition(manager, 'https://archive.test');

		expect(query).toHaveBeenCalledWith(historyArchiveRootTransitionLockSql, [
			'https://archive.test'
		]);
	});

	it('resolves and locks the object root before a terminal update', async () => {
		const query = jest.fn().mockResolvedValue([]);
		const manager = { query } as unknown as EntityManager;
		const remoteId = '00000000-0000-4000-8000-000000000001';

		await lockHistoryArchiveObjectRootTransition(manager, remoteId);

		expect(query).toHaveBeenCalledWith(
			historyArchiveObjectRootTransitionLockSql,
			[remoteId]
		);
	});
});
