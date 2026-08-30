import type { EntityManager } from 'typeorm';
import {
	getHistoryArchiveTransitionReconciliation,
	historyArchiveTransitionReconciliationHealthSql
} from '../HistoryArchiveTransitionReconciliationQuery.js';

describe('history archive transition reconciliation health', () => {
	it('counts only terminal objects that the reconciler can execute', async () => {
		const query = jest.fn().mockResolvedValue([
			{
				oldestPendingAt: '2026-08-30T20:00:00.000Z',
				pendingTerminalEffects: '2'
			}
		]);
		const result = await getHistoryArchiveTransitionReconciliation(
			{ query } as unknown as EntityManager,
			new Date('2026-08-30T20:00:30.000Z')
		);

		expect(historyArchiveTransitionReconciliationHealthSql).toContain(
			"object.status in ('verified', 'failed')"
		);
		expect(query).toHaveBeenCalledWith(
			historyArchiveTransitionReconciliationHealthSql
		);
		expect(result).toEqual({
			oldestPendingAgeMs: 30_000,
			oldestPendingAt: '2026-08-30T20:00:00.000Z',
			pendingTerminalEffects: 2,
			status: 'reconciling'
		});
	});
});
