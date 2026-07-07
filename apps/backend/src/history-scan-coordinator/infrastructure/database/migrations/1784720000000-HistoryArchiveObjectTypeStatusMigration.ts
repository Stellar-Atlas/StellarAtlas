import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveObjectTypeStatusMigration1784720000000
	implements MigrationInterface
{
	name = 'HistoryArchiveObjectTypeStatusMigration1784720000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create index if not exists
				"idx_history_archive_object_type_status"
			on "history_archive_object_queue" ("objectType", status)
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop index if exists "idx_history_archive_object_type_status"
		`);
	}
}
