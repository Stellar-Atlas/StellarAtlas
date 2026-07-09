import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveStateLatestFailureMigration1784770000000
	implements MigrationInterface
{
	name = 'HistoryArchiveStateLatestFailureMigration1784770000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "history_archive_state_snapshot"
				add column if not exists "latestFailureObservedAt" timestamptz,
				add column if not exists "latestFailureSource" text,
				add column if not exists "latestFailureType" text,
				add column if not exists "latestFailureMessage" text,
				add column if not exists "latestFailureHttpStatus" integer
		`);
		await queryRunner.query(`
			update "history_archive_state_snapshot"
			set
				"latestFailureObservedAt" = "observedAt",
				"latestFailureSource" = "source",
				"latestFailureType" = "errorType",
				"latestFailureMessage" = "errorMessage",
				"latestFailureHttpStatus" = "httpStatus"
			where "status" != 'available'
				and "latestFailureObservedAt" is null
		`);
		await queryRunner.query(`
			create index if not exists
				"IDX_history_archive_state_latest_failure_observed"
			on "history_archive_state_snapshot" ("latestFailureObservedAt")
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop index if exists
				"IDX_history_archive_state_latest_failure_observed"
		`);
		await queryRunner.query(`
			alter table "history_archive_state_snapshot"
				drop column if exists "latestFailureHttpStatus",
				drop column if exists "latestFailureMessage",
				drop column if exists "latestFailureType",
				drop column if exists "latestFailureSource",
				drop column if exists "latestFailureObservedAt"
		`);
	}
}
