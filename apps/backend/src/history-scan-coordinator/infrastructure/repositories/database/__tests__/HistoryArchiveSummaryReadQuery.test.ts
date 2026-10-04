import type { EntityManager } from 'typeorm';
import {
	historyArchiveSummaryLockTimeoutMs,
	historyArchiveSummaryReadSettingsSql,
	historyArchiveSummaryStatementTimeoutMs,
	queryHistoryArchiveSummary
} from '../HistoryArchiveSummaryReadQuery.js';

function createManager() {
	const query = jest.fn<Promise<unknown>, [string, unknown[]]>();
	const transactionManager = { query } as unknown as EntityManager;
	const transaction = jest.fn(
		async (work: (manager: EntityManager) => Promise<unknown>) =>
			work(transactionManager)
	);
	const manager = { transaction } as unknown as EntityManager;
	return { manager, query, transaction };
}

describe('bounded archive summary reads', () => {
	it('sets local deadlines on the same connection before the unchanged query', async () => {
		const { manager, query, transaction } = createManager();
		const rows = [{ verified: '42' }];
		query.mockResolvedValueOnce([]).mockResolvedValueOnce(rows);
		const parameters = ['https://archive.example'];

		await expect(
			queryHistoryArchiveSummary(
				manager,
				'select exact_proof_counts($1)',
				parameters
			)
		).resolves.toBe(rows);

		expect(transaction).toHaveBeenCalledTimes(1);
		expect(query).toHaveBeenNthCalledWith(
			1,
			historyArchiveSummaryReadSettingsSql,
			[
				`${historyArchiveSummaryStatementTimeoutMs}ms`,
				`${historyArchiveSummaryLockTimeoutMs}ms`
			]
		);
		expect(query).toHaveBeenNthCalledWith(
			2,
			'select exact_proof_counts($1)',
			parameters
		);
		expect(historyArchiveSummaryReadSettingsSql).toContain(
			"set_config('statement_timeout', $1::text, true)"
		);
		expect(historyArchiveSummaryReadSettingsSql).toContain(
			"set_config('lock_timeout', $2::text, true)"
		);
		expect(historyArchiveSummaryStatementTimeoutMs).toBeLessThan(10_000);
	});

	it('propagates a database timeout for rollback without retry or fabricated counts', async () => {
		const { manager, query, transaction } = createManager();
		const timeout = new Error('canceling statement due to statement timeout');
		query.mockResolvedValueOnce([]).mockRejectedValueOnce(timeout);

		await expect(
			queryHistoryArchiveSummary(manager, 'select slow_counts()', [])
		).rejects.toBe(timeout);
		expect(transaction).toHaveBeenCalledTimes(1);
		expect(query).toHaveBeenCalledTimes(2);
	});

	it('does not run an unbounded query if installing the deadlines fails', async () => {
		const { manager, query } = createManager();
		const failure = new Error('connection lost');
		query.mockRejectedValueOnce(failure);

		await expect(
			queryHistoryArchiveSummary(manager, 'select counts()', [])
		).rejects.toBe(failure);
		expect(query).toHaveBeenCalledTimes(1);
	});
});
