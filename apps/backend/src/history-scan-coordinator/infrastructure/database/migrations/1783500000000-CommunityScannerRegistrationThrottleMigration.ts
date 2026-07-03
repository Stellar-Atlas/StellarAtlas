import { MigrationInterface, QueryRunner } from 'typeorm';

export class CommunityScannerRegistrationThrottleMigration1783500000000
	implements MigrationInterface
{
	name = 'CommunityScannerRegistrationThrottleMigration1783500000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "community_scanner_registration_throttles" (
				"source_ip_hash" char(64) NOT NULL,
				"window_started_at" TIMESTAMP WITH TIME ZONE NOT NULL,
				"attempt_count" integer NOT NULL DEFAULT 0,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "PK_community_scanner_registration_throttles_source"
					PRIMARY KEY ("source_ip_hash")
			)
		`);
		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS
			"idx_community_scanner_registration_throttles_updated_at"
			ON "community_scanner_registration_throttles" ("updated_at")
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			DROP INDEX IF EXISTS
			"idx_community_scanner_registration_throttles_updated_at"
		`);
		await queryRunner.query(`
			DROP TABLE IF EXISTS "community_scanner_registration_throttles"
		`);
	}
}
