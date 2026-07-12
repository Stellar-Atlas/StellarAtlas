import type { QueryRunner } from 'typeorm';
import {
	HistoryArchiveSchedulerOnlineIndexesMigration1784810000000,
	schedulerOnlineIndexDiskEstimate
} from '../1784810000000-HistoryArchiveSchedulerOnlineIndexesMigration.js';

describe('HistoryArchiveSchedulerOnlineIndexesMigration1784810000000', () => {
	it('builds only the two bounded live-queue indexes concurrently', async () => {
		const queries: string[] = [];
		const states = [
			{ exists: false, valid: false },
			{ exists: false, valid: false }
		];
		const queryRunner = {
			query: jest.fn(async (sql: string) => {
				queries.push(sql);
				return sql.includes('from pg_class') ? [states.shift()] : [];
			})
		} as unknown as QueryRunner;
		const migration =
			new HistoryArchiveSchedulerOnlineIndexesMigration1784810000000();

		await migration.up(queryRunner);
		const sql = queries.join('\n');

		expect(migration.transaction).toBe(false);
		expect(sql.match(/create index concurrently/g)).toHaveLength(2);
		expect(schedulerOnlineIndexDiskEstimate.estimatedPeakBytes).toBeLessThan(
			18n * 1024n * 1024n * 1024n
		);
		expect(sql).toContain('"idx_history_archive_object_executable_claim"');
		expect(sql).toContain('"idx_history_archive_object_transition_reconcile"');
		expect(sql).toContain('indisvalid');
		expect(sql).toContain('indisready');
		expect(sql).toContain('analyze (skip_locked)');
		expect(queries.at(-1)).toContain('set lock_timeout = default');
		expect(sql).not.toContain('"uq_history_archive_object_terminal_event"');
		expect(sql).not.toContain(
			'update "history_archive_object_queue" set "lastClaimedAt"'
		);
	});

	it('drops interrupted invalid scheduler indexes before rebuilding', async () => {
		const queries: string[] = [];
		const states = [
			{ exists: true, valid: false },
			{ exists: true, valid: false }
		];
		const queryRunner = {
			query: jest.fn(async (sql: string) => {
				queries.push(sql);
				return sql.includes('from pg_class') ? [states.shift()] : [];
			})
		} as unknown as QueryRunner;

		await new HistoryArchiveSchedulerOnlineIndexesMigration1784810000000().up(
			queryRunner
		);

		expect(queries.join('\n')).toContain(
			'drop index concurrently if exists "idx_history_archive_object_executable_claim"'
		);
		expect(queries.join('\n')).toContain(
			'drop index concurrently if exists "idx_history_archive_object_transition_reconcile"'
		);
	});

	it('fails closed before issuing SQL when disk capacity cannot be checked', async () => {
		const previousPath =
			process.env.HISTORY_ARCHIVE_SCHEDULER_MIGRATION_DATA_PATH;
		process.env.HISTORY_ARCHIVE_SCHEDULER_MIGRATION_DATA_PATH =
			'/path-that-does-not-exist';
		const queryRunner = { query: jest.fn() } as unknown as QueryRunner;

		try {
			await expect(
				new HistoryArchiveSchedulerOnlineIndexesMigration1784810000000().up(
					queryRunner
				)
			).rejects.toThrow('cannot verify free disk');
			expect(queryRunner.query).not.toHaveBeenCalled();
		} finally {
			if (previousPath === undefined) {
				delete process.env.HISTORY_ARCHIVE_SCHEDULER_MIGRATION_DATA_PATH;
			} else {
				process.env.HISTORY_ARCHIVE_SCHEDULER_MIGRATION_DATA_PATH =
					previousPath;
			}
		}
	});
});
