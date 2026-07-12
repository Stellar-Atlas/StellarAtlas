import type { QueryRunner } from 'typeorm';
import { mock } from 'jest-mock-extended';
import { HistoryArchiveObjectEventSummaryMigration1785000000000 } from '../1785000000000-HistoryArchiveObjectEventSummaryMigration.js';

describe('HistoryArchiveObjectEventSummaryMigration1785000000000', () => {
	it('installs durable counters before bounded historical backfill', async () => {
		const statements: string[] = [];
		const runner = mock<QueryRunner>();
		runner.query.mockImplementation(async (sql: string) => {
			statements.push(sql);
			return sql.includes('select coalesce(max(id)')
				? [{ cutoff: '1900000' }]
				: [];
		});
		const migration =
			new HistoryArchiveObjectEventSummaryMigration1785000000000();

		await migration.up(runner);

		const sql = statements.join('\n');
		expect(migration.transaction).toBe(false);
		expect(sql).toContain('history_archive_object_event_summary');
		expect(sql).toContain('lock table history_archive_object_event');
		expect(sql).toContain('truncate history_archive_object_event_summary');
		expect(sql).toContain('refresh_history_archive_object_event_summary');
		expect(sql).toContain('after truncate');
		expect(sql).toContain('where id <= $1::bigint');
		expect(runner.startTransaction).toHaveBeenCalledTimes(1);
		expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
		expect(runner.query).toHaveBeenLastCalledWith(
			expect.stringContaining('where id <= $1::bigint'),
			[1900000]
		);
	});
});
