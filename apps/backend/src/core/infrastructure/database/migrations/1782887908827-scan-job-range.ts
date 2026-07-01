import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScanJobRange1782887908827 implements MigrationInterface {
	name = 'ScanJobRange1782887908827';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "history_archive_scan_job_queue" ADD "fromLedger" integer`
		);
		await queryRunner.query(
			`ALTER TABLE "history_archive_scan_job_queue" ADD "toLedger" integer`
		);
		await queryRunner.query(
			`ALTER TABLE "history_archive_scan_job_queue" ADD "concurrency" integer`
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "history_archive_scan_job_queue" DROP COLUMN "concurrency"`
		);
		await queryRunner.query(
			`ALTER TABLE "history_archive_scan_job_queue" DROP COLUMN "toLedger"`
		);
		await queryRunner.query(
			`ALTER TABLE "history_archive_scan_job_queue" DROP COLUMN "fromLedger"`
		);
	}
}
