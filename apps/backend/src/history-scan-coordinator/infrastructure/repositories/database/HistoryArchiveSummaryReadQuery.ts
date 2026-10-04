import type { EntityManager } from 'typeorm';

// These public reads may expand the proof-version view into a full proof scan.
// Bound the database work itself: an HTTP client's timeout does not cancel it.
export const historyArchiveSummaryStatementTimeoutMs = 8_000;
export const historyArchiveSummaryLockTimeoutMs = 250;

export const historyArchiveSummaryReadSettingsSql = `
	select
		set_config('statement_timeout', $1::text, true),
		set_config('lock_timeout', $2::text, true)
`;

export async function queryHistoryArchiveSummary<Row>(
	manager: EntityManager,
	sql: string,
	parameters: readonly unknown[]
): Promise<readonly Row[]> {
	return manager.transaction(async (transactionManager) => {
		await transactionManager.query(historyArchiveSummaryReadSettingsSql, [
			`${historyArchiveSummaryStatementTimeoutMs}ms`,
			`${historyArchiveSummaryLockTimeoutMs}ms`
		]);
		return transactionManager.query<readonly Row[]>(sql, [...parameters]);
	});
}
