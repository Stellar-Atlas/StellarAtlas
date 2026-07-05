import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveScanMetadataMigration1784200000000
	implements MigrationInterface
{
	name = 'HistoryArchiveScanMetadataMigration1784200000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "history_archive_scan_v2"
			add column if not exists "archiveMetadata" jsonb
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "history_archive_scan_v2"
			drop column if exists "archiveMetadata"
		`);
	}
}
