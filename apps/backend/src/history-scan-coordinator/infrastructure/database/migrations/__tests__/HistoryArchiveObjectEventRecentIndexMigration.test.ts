import { mock } from 'jest-mock-extended';
import type { QueryRunner } from 'typeorm';
import {
	historyArchiveObjectEventRecentIndexSql,
	HistoryArchiveObjectEventRecentIndexMigration1785020000000
} from '../1785020000000-HistoryArchiveObjectEventRecentIndexMigration.js';

describe('HistoryArchiveObjectEventRecentIndexMigration', () => {
	it('adds the global recent-event index without a migration transaction', async () => {
		const queryRunner = mock<QueryRunner>();
		const migration =
			new HistoryArchiveObjectEventRecentIndexMigration1785020000000();

		await migration.up(queryRunner);

		expect(migration.transaction).toBe(false);
		expect(historyArchiveObjectEventRecentIndexSql).toContain(
			'("createdAt" desc, id desc)'
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			historyArchiveObjectEventRecentIndexSql
		);
	});
});
