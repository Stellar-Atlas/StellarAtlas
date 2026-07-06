import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveObjectRetryTelemetryMigration1784360000000
	implements MigrationInterface
{
	name = 'HistoryArchiveObjectRetryTelemetryMigration1784360000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "history_archive_object_queue"
				add column if not exists "nextAttemptAt" timestamptz,
				add column if not exists "refreshAfter" timestamptz,
				add column if not exists "verificationFacts" jsonb
		`);
		await queryRunner.query(`
			update "history_archive_object_queue"
			set "nextAttemptAt" = "updatedAt" + interval '1 hour'
			where status = 'failed'
				and "nextAttemptAt" is null
		`);
		await queryRunner.query(`
			update "history_archive_object_queue"
			set "refreshAfter" = "updatedAt" + interval '5 minutes'
			where status = 'verified'
				and "objectType" = 'history-archive-state'
				and "objectKey" = 'root'
				and "refreshAfter" is null
		`);
		await queryRunner.query(`
			create index if not exists "idx_history_archive_object_retry"
			on "history_archive_object_queue" (
				"nextAttemptAt",
				"objectOrder",
				"objectKey",
				"archiveUrlIdentity"
			)
			where status = 'failed'
		`);
		await queryRunner.query(`
			create index if not exists "idx_history_archive_object_refresh"
			on "history_archive_object_queue" (
				"refreshAfter",
				"archiveUrlIdentity"
			)
			where status = 'verified'
				and "objectType" = 'history-archive-state'
				and "objectKey" = 'root'
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop index if exists "idx_history_archive_object_refresh"
		`);
		await queryRunner.query(`
			drop index if exists "idx_history_archive_object_retry"
		`);
		await queryRunner.query(`
			alter table "history_archive_object_queue"
				drop column if exists "verificationFacts",
				drop column if exists "refreshAfter",
				drop column if exists "nextAttemptAt"
		`);
	}
}
