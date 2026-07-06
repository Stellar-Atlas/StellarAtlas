import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScanJobAttemptedProgressMigration1784330000000 implements MigrationInterface {
	name = 'ScanJobAttemptedProgressMigration1784330000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table history_archive_scan_job_queue
			add column if not exists "latestAttemptedLedger" integer
		`);
		await queryRunner.query(`
			alter table history_archive_scan_job_queue
			add column if not exists "currentRangeFromLedger" integer
		`);
		await queryRunner.query(`
			alter table history_archive_scan_job_queue
			add column if not exists "currentRangeToLedger" integer
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table history_archive_scan_job_queue
			drop column if exists "currentRangeToLedger"
		`);
		await queryRunner.query(`
			alter table history_archive_scan_job_queue
			drop column if exists "currentRangeFromLedger"
		`);
		await queryRunner.query(`
			alter table history_archive_scan_job_queue
			drop column if exists "latestAttemptedLedger"
		`);
	}
}
