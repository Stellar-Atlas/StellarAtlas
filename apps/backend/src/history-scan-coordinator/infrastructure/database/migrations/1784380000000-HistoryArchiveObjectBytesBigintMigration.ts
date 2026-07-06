import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveObjectBytesBigintMigration1784380000000
	implements MigrationInterface
{
	name = 'HistoryArchiveObjectBytesBigintMigration1784380000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "history_archive_object_queue"
				alter column "bytesDownloaded" type bigint
				using "bytesDownloaded"::bigint
		`);
		await queryRunner.query(`
			alter table "history_archive_object_event"
				alter column "bytesDownloaded" type bigint
				using "bytesDownloaded"::bigint
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "history_archive_object_event"
				alter column "bytesDownloaded" type integer
				using "bytesDownloaded"::integer
		`);
		await queryRunner.query(`
			alter table "history_archive_object_queue"
				alter column "bytesDownloaded" type integer
				using "bytesDownloaded"::integer
		`);
	}
}
