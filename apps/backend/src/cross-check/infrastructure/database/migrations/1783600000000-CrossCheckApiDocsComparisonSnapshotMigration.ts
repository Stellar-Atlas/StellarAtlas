import { MigrationInterface, QueryRunner } from 'typeorm';

export class CrossCheckApiDocsComparisonSnapshotMigration1783600000000 implements MigrationInterface {
	name = 'CrossCheckApiDocsComparisonSnapshotMigration1783600000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "cross_check_api_docs_comparison_snapshots" (
				"id" uuid NOT NULL DEFAULT gen_random_uuid(),
				"status" varchar(32) NOT NULL,
				"generated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
				"comparison" jsonb,
				"failure" jsonb,
				"stored_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "PK_cross_check_api_docs_snapshots_id" PRIMARY KEY ("id"),
				CONSTRAINT "CHK_cross_check_api_docs_snapshots_status"
					CHECK ("status" IN ('compared', 'failed')),
				CONSTRAINT "CHK_cross_check_api_docs_snapshots_payload"
					CHECK (
						("status" = 'compared' AND "comparison" IS NOT NULL AND "failure" IS NULL)
						OR ("status" = 'failed' AND "comparison" IS NULL AND "failure" IS NOT NULL)
					)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS
			"idx_cross_check_api_docs_snapshots_latest"
			ON "cross_check_api_docs_comparison_snapshots" (
				"generated_at",
				"stored_at",
				"id"
			)
		`);
		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS
			"idx_cross_check_api_docs_snapshots_status_generated_at"
			ON "cross_check_api_docs_comparison_snapshots" ("status", "generated_at")
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			DROP INDEX IF EXISTS
			"idx_cross_check_api_docs_snapshots_status_generated_at"
		`);
		await queryRunner.query(`
			DROP INDEX IF EXISTS
			"idx_cross_check_api_docs_snapshots_latest"
		`);
		await queryRunner.query(`
			DROP TABLE IF EXISTS "cross_check_api_docs_comparison_snapshots"
		`);
	}
}
