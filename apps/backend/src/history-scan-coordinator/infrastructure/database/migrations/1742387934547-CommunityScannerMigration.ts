import { MigrationInterface, QueryRunner } from 'typeorm';

export class CommunityScannerMigration1742387934547 implements MigrationInterface {
	name = 'CommunityScannerMigration1742387934547';

	public async up(queryRunner: QueryRunner): Promise<void> {
		// Check if community_scanners table already exists to avoid conflicts
		const hasTable = await queryRunner.hasTable('community_scanners');
		if (hasTable) {
			return;
		}

		// Create community_scanners table
		await queryRunner.query(`
			CREATE TABLE "community_scanners" (
				"id" uuid NOT NULL DEFAULT gen_random_uuid(),
				"name" varchar(100) NOT NULL,
				"description" varchar(500),
				"contact_email" varchar(255) NOT NULL,
				"api_key" varchar(255) NOT NULL,
				"status" varchar CHECK ("status" IN ('pending', 'online', 'offline', 'degraded')) NOT NULL DEFAULT 'pending',
				"success_rate" decimal(5,2) NOT NULL DEFAULT 0,
				"average_completion_time_ms" bigint NOT NULL DEFAULT 0,
				"total_jobs_completed" bigint NOT NULL DEFAULT 0,
				"total_jobs_failed" bigint NOT NULL DEFAULT 0,
				"current_active_jobs" integer NOT NULL DEFAULT 0,
				"is_blacklisted" boolean NOT NULL DEFAULT false,
				"blacklisted_until" timestamp,
				"last_heartbeat_at" timestamp,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "PK_community_scanners_id" PRIMARY KEY ("id"),
				CONSTRAINT "UQ_community_scanners_api_key" UNIQUE ("api_key")
			)
		`);

		// Create indexes for performance
		await queryRunner.query(`CREATE INDEX "IDX_community_scanners_id" ON "community_scanners" ("id")`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_community_scanners_api_key" ON "community_scanners" ("api_key")`);
		await queryRunner.query(`CREATE INDEX "IDX_community_scanners_status" ON "community_scanners" ("status")`);
		await queryRunner.query(`CREATE INDEX "IDX_community_scanners_last_heartbeat" ON "community_scanners" ("last_heartbeat_at")`);
		await queryRunner.query(`CREATE INDEX "IDX_community_scanners_blacklisted" ON "community_scanners" ("is_blacklisted")`);
		await queryRunner.query(`CREATE INDEX "IDX_community_scanners_email" ON "community_scanners" ("contact_email")`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		// Check if table exists before dropping
		const hasTable = await queryRunner.hasTable('community_scanners');
		if (!hasTable) {
			return;
		}

		// Drop indexes first
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_community_scanners_email"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_community_scanners_blacklisted"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_community_scanners_last_heartbeat"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_community_scanners_status"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_community_scanners_api_key"`);
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_community_scanners_id"`);
		
		// Drop table
		await queryRunner.query(`DROP TABLE "community_scanners"`);
	}
}