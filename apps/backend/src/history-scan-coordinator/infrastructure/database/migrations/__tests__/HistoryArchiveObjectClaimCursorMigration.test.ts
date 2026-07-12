import { HistoryArchiveObjectClaimCursorMigration1784780000000 } from '../1784780000000-HistoryArchiveObjectClaimCursorMigration.js';

describe('HistoryArchiveObjectClaimCursorMigration1784780000000', () => {
	let migration: HistoryArchiveObjectClaimCursorMigration1784780000000;
	let queryRunner: { query: jest.Mock };

	beforeEach(() => {
		migration = new HistoryArchiveObjectClaimCursorMigration1784780000000();
		queryRunner = { query: jest.fn() };
	});

	it('adds metadata-only scheduler columns and empty coordination tables', async () => {
		await migration.up(queryRunner as never);
		const sql = queryRunner.query.mock.calls.join('\n');

		expect(sql).toContain('add column if not exists "lastClaimedAt"');
		expect(sql).toContain('add column if not exists "dependencyReady"');
		expect(sql).toContain('"history_archive_object_claim_slot"');
		expect(sql).toContain('"history_archive_object_plan"');
		expect(sql).toContain('"history_archive_checkpoint_bucket_dependency"');
		expect(sql).toContain('"history_archive_object_frontier_cursor"');
		expect(sql).toContain("default 'deferred'");
		expect(sql).toContain("default 'legacy-planning-intent'");
		expect(sql).toContain("set local lock_timeout = '2s'");
		expect(sql).not.toContain('update "history_archive_object_queue"');
		expect(sql).not.toContain(
			'create index concurrently if not exists\n\t\t\t\t\t"idx_history_archive_object'
		);
	});

	it('drops additive tables and columns', async () => {
		await migration.down(queryRunner as never);
		const sql = queryRunner.query.mock.calls.join('\n');

		expect(sql).toContain('drop table if exists');
		expect(sql).toContain('drop column if exists "lastClaimedAt"');
	});
});
