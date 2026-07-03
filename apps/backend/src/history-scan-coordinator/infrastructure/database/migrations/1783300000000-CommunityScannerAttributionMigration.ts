import { MigrationInterface, QueryRunner } from 'typeorm';

export class CommunityScannerAttributionMigration1783300000000 implements MigrationInterface {
	name = 'CommunityScannerAttributionMigration1783300000000';
	transaction = false;

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE "history_archive_scan_job_queue"
			ADD COLUMN IF NOT EXISTS "claimedByCommunityScannerId" uuid
		`);
		await queryRunner.query(`
			ALTER TABLE "history_archive_scan_job_queue"
			ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP WITH TIME ZONE
		`);
		await queryRunner.query(`
			ALTER TABLE "history_archive_scan_v2"
			ADD COLUMN IF NOT EXISTS "communityScannerId" uuid
		`);
		await queryRunner.query(`
			ALTER TABLE "history_archive_scan_v2"
			ADD COLUMN IF NOT EXISTS "scanJobRemoteId" text
		`);

		await queryRunner.query(`
			CREATE INDEX CONCURRENTLY IF NOT EXISTS
			"idx_scanjob_claimed_by_community_scanner"
			ON "history_archive_scan_job_queue" ("claimedByCommunityScannerId")
		`);
		await queryRunner.query(`
			CREATE INDEX CONCURRENTLY IF NOT EXISTS
			"idx_scanjob_claimed_at"
			ON "history_archive_scan_job_queue" ("claimedAt")
		`);
		await queryRunner.query(`
			CREATE INDEX CONCURRENTLY IF NOT EXISTS
			"idx_archive_scan_community_scanner_id"
			ON "history_archive_scan_v2" ("communityScannerId")
		`);
		await queryRunner.query(`
			CREATE INDEX CONCURRENTLY IF NOT EXISTS
			"idx_archive_scan_job_remote_id"
			ON "history_archive_scan_v2" ("scanJobRemoteId")
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			DROP INDEX CONCURRENTLY IF EXISTS "idx_archive_scan_job_remote_id"
		`);
		await queryRunner.query(`
			DROP INDEX CONCURRENTLY IF EXISTS
			"idx_archive_scan_community_scanner_id"
		`);
		await queryRunner.query(`
			DROP INDEX CONCURRENTLY IF EXISTS "idx_scanjob_claimed_at"
		`);
		await queryRunner.query(`
			DROP INDEX CONCURRENTLY IF EXISTS
			"idx_scanjob_claimed_by_community_scanner"
		`);
		await queryRunner.query(`
			ALTER TABLE "history_archive_scan_v2"
			DROP COLUMN IF EXISTS "scanJobRemoteId"
		`);
		await queryRunner.query(`
			ALTER TABLE "history_archive_scan_v2"
			DROP COLUMN IF EXISTS "communityScannerId"
		`);
		await queryRunner.query(`
			ALTER TABLE "history_archive_scan_job_queue"
			DROP COLUMN IF EXISTS "claimedAt"
		`);
		await queryRunner.query(`
			ALTER TABLE "history_archive_scan_job_queue"
			DROP COLUMN IF EXISTS "claimedByCommunityScannerId"
		`);
	}
}
