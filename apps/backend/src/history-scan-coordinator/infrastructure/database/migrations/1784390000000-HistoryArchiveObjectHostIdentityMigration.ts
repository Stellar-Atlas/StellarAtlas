import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveObjectHostIdentityMigration1784390000000
	implements MigrationInterface
{
	name = 'HistoryArchiveObjectHostIdentityMigration1784390000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "history_archive_object_queue"
			add column if not exists "hostIdentity" text
		`);
		await queryRunner.query(`
			update "history_archive_object_queue"
			set "hostIdentity" = lower(
				split_part(
					regexp_replace("archiveUrl", '^https?://', '', 'i'),
					'/',
					1
				)
			)
			where "hostIdentity" is null
		`);
		await queryRunner.query(`
			alter table "history_archive_object_queue"
			alter column "hostIdentity" set not null
		`);
		await queryRunner.query(`
			create index if not exists "idx_history_archive_object_host"
			on "history_archive_object_queue" ("hostIdentity", "status")
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`drop index if exists "idx_history_archive_object_host"`
		);
		await queryRunner.query(`
			alter table "history_archive_object_queue"
			drop column if exists "hostIdentity"
		`);
	}
}
