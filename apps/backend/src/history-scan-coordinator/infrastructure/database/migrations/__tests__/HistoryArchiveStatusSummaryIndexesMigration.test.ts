import type { QueryRunner } from 'typeorm';
import { HistoryArchiveStatusSummaryIndexesMigration1784800000000 } from '../1784800000000-HistoryArchiveStatusSummaryIndexesMigration.js';

describe('HistoryArchiveStatusSummaryIndexesMigration', () => {
	it('builds nonblocking covering indexes for the headline query shape', async () => {
		const queries: string[] = [];
		const states = [
			{ exists: false, valid: false },
			{ exists: true, valid: true },
			{ exists: false, valid: false }
		];
		const queryRunner = {
			query: jest.fn(async (sql: string) => {
				queries.push(sql);
				if (sql.includes('as "tupleBytes"')) return [{ tupleBytes: '4096' }];
				if (sql.includes('from pg_class')) {
					return [states.shift()];
				}
				return [];
			})
		} as unknown as QueryRunner;
		const migration =
			new HistoryArchiveStatusSummaryIndexesMigration1784800000000();

		await migration.up(queryRunner);

		const sql = queries.join('\n');
		expect(migration.transaction).toBe(false);
		expect(sql).toContain('create index concurrently');
		expect(sql).toContain('"idx_history_archive_object_root_summary"');
		expect(sql).toContain('where "objectType" = \'history-archive-state\'');
		expect(sql).not.toContain(
			'create index concurrently if not exists\n\t\t\t\t"idx_history_archive_checkpoint_proof_summary"'
		);
	});

	it('drops an interrupted invalid index before rebuilding it', async () => {
		const queries: string[] = [];
		const states = [
			{ exists: true, valid: false },
			{ exists: true, valid: true },
			{ exists: true, valid: false }
		];
		const queryRunner = {
			query: jest.fn(async (sql: string) => {
				queries.push(sql);
				if (sql.includes('as "tupleBytes"')) return [{ tupleBytes: '4096' }];
				return sql.includes('from pg_class') ? [states.shift()] : [];
			})
		} as unknown as QueryRunner;

		await new HistoryArchiveStatusSummaryIndexesMigration1784800000000().up(
			queryRunner
		);

		expect(queries.join('\n')).toContain(
			'drop index concurrently if exists "idx_history_archive_object_root_summary"'
		);
		expect(queries.join('\n')).toContain(
			'drop index concurrently if exists "idx_history_archive_checkpoint_proof_summary"'
		);
	});
});
