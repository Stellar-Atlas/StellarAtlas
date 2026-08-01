import type { QueryRunner } from 'typeorm';
import { HistoryArchiveReadyQueueIndexesMigration1785280000000 } from '../1785280000000-HistoryArchiveReadyQueueIndexesMigration.js';

describe('HistoryArchiveReadyQueueIndexesMigration1785280000000', () => {
	it('builds bounded scheduler indexes concurrently', async () => {
		const queries: string[] = [];
		const migration =
			new HistoryArchiveReadyQueueIndexesMigration1785280000000();

		await migration.up(queryRecorder(queries));

		expect(migration.transaction).toBe(false);
		const sql = queries.join('\n');
		expect(sql.match(/create index concurrently/g)).toHaveLength(2);
		expect(sql).toContain('idx_history_archive_object_dependency_reconcile');
		expect(sql).toContain('"dependencyReady" is null');
		expect(sql).toContain('idx_history_archive_object_plan_root_created');
		expect(sql).not.toContain('parsed_transaction_result');
		expect(sql).not.toContain('analyze (skip_locked)');
		expect(queries.at(-2)).toContain('set statement_timeout = default');
		expect(queries.at(-1)).toContain('set lock_timeout = default');
	});
});

function queryRecorder(queries: string[]): QueryRunner {
	return {
		query: jest.fn(async (sql: string) => {
			queries.push(sql);
			return [];
		})
	} as unknown as QueryRunner;
}
