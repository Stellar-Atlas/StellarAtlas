import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveBrokerFrontierMigration1785440000000
	implements MigrationInterface
{
	name = 'HistoryArchiveBrokerFrontierMigration1785440000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`set local lock_timeout = '2s'`);
		await queryRunner.query(`
			alter table "history_archive_object_ready"
				add column if not exists "dispatchToken" uuid,
				add column if not exists "claimAttempt" integer,
				add column if not exists "publishedAt" timestamptz
		`);
		await queryRunner.query(`
			alter table "history_archive_object_ready"
				drop constraint if exists "history_archive_object_ready_claim_attempt_check"
		`);
		await queryRunner.query(`
			alter table "history_archive_object_ready"
				add constraint "history_archive_object_ready_claim_attempt_check"
				check ("claimAttempt" is null or "claimAttempt" > 0) not valid
		`);
		await queryRunner.query(`
			alter table "history_archive_object_ready"
				validate constraint "history_archive_object_ready_claim_attempt_check"
		`);
		await queryRunner.query(`
			create unique index if not exists
				"history_archive_object_ready_dispatch_token_key"
			on "history_archive_object_ready" ("dispatchToken")
			where "dispatchToken" is not null
		`);
		await queryRunner.query(`
			create index if not exists
				"history_archive_object_ready_broker_admission_idx"
			on "history_archive_object_ready" (
				"publishedAt",
				priority,
				"availableAt",
				"updatedAt"
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop index if exists
				"history_archive_object_ready_broker_admission_idx"
		`);
		await queryRunner.query(`
			drop index if exists
				"history_archive_object_ready_dispatch_token_key"
		`);
		await queryRunner.query(`
			alter table "history_archive_object_ready"
				drop constraint if exists
					"history_archive_object_ready_claim_attempt_check",
				drop column if exists "publishedAt",
				drop column if exists "claimAttempt",
				drop column if exists "dispatchToken"
		`);
	}
}
