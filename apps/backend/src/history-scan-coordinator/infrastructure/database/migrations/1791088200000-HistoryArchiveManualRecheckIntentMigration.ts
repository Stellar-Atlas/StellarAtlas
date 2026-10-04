import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Nullable metadata on the bounded ready queue; no backfill, default or index. */
export class HistoryArchiveManualRecheckIntentMigration1791088200000 implements MigrationInterface {
	readonly name = 'HistoryArchiveManualRecheckIntentMigration1791088200000';
	async up(runner: QueryRunner): Promise<void> {
		await runner.query(`alter table history_archive_object_ready
			add column if not exists "recheckRequestedAt" timestamptz`);
	}
	async down(runner: QueryRunner): Promise<void> {
		await runner.query(`alter table history_archive_object_ready
			drop column if exists "recheckRequestedAt"`);
	}
}
