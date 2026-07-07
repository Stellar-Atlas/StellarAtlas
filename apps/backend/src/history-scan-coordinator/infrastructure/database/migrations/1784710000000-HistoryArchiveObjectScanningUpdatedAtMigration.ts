import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveObjectScanningUpdatedAtMigration1784710000000
	implements MigrationInterface
{
	name = 'HistoryArchiveObjectScanningUpdatedAtMigration1784710000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create index if not exists
				"idx_history_archive_object_scanning_updated_at"
			on "history_archive_object_queue" ("updatedAt")
			where status = 'scanning'
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop index if exists
				"idx_history_archive_object_scanning_updated_at"
		`);
	}
}
