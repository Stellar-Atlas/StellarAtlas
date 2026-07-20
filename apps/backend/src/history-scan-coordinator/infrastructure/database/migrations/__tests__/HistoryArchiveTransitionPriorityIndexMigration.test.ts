import type { QueryRunner } from 'typeorm';
import { HistoryArchiveTransitionPriorityIndexMigration1785240000000 } from '../1785240000000-HistoryArchiveTransitionPriorityIndexMigration.js';

describe('HistoryArchiveTransitionPriorityIndexMigration1785240000000', () => {
	it('builds a concurrent partial index for proof transition priority', async () => {
		const queries: string[] = [];
		const queryRunner = queryRecorder(queries, false);
		const migration =
			new HistoryArchiveTransitionPriorityIndexMigration1785240000000();

		await migration.up(queryRunner);

		expect(migration.transaction).toBe(false);
		const sql = queries.join('\n');
		expect(sql).toContain('set statement_timeout = 0');
		expect(sql).toContain('create index concurrently');
		expect(sql).toContain('"idx_history_archive_object_transition_priority"');
		expect(sql).toContain("when 'canonical-frontier-reserve' then 0");
		expect(sql).toContain("when 'proof-completion-reserve' then 1");
		expect(sql).toContain('"transitionEffectsRequiredAt" is not null');
		expect(sql).toContain('"transitionEffectsCompletedAt" is null');
		expect(sql).toContain('indisvalid and indisready');
		expect(queries.at(-2)).toContain('set statement_timeout = default');
		expect(queries.at(-1)).toContain('set lock_timeout = default');
	});

	it('removes an interrupted index before rebuilding it', async () => {
		const queries: string[] = [];
		const queryRunner = queryRecorder(queries, true);

		await new HistoryArchiveTransitionPriorityIndexMigration1785240000000().up(
			queryRunner
		);

		expect(queries.join('\n')).toContain(
			'drop index concurrently if exists "idx_history_archive_object_transition_priority"'
		);
	});
});

function queryRecorder(
	queries: string[],
	invalidIndexExists: boolean
): QueryRunner {
	return {
		query: jest.fn(async (sql: string) => {
			queries.push(sql);
			return sql.includes('from pg_class')
				? [{ exists: invalidIndexExists, valid: false }]
				: [];
		})
	} as unknown as QueryRunner;
}
