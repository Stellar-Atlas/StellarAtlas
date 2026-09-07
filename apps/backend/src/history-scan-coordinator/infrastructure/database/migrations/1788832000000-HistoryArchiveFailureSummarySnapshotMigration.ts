import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Small rebuildable read cache, not a per-file evidence log or terminal write hook. */
export class HistoryArchiveFailureSummarySnapshotMigration1788832000000 implements MigrationInterface {
	readonly name = 'HistoryArchiveFailureSummarySnapshotMigration1788832000000';
	async up(runner: QueryRunner): Promise<void> {
		await runner.query(`create table history_archive_failure_summary_snapshot (
			"archiveUrlIdentity" text primary key,
			summary jsonb,
			"computedAt" timestamptz,
			"lastAttemptAt" timestamptz not null,
			"lastErrorCode" text
		)`);
	}
	async down(runner: QueryRunner): Promise<void> {
		await runner.query('drop table history_archive_failure_summary_snapshot');
	}
}
