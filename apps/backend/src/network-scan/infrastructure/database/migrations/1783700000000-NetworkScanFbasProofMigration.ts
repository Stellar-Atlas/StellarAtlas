import { MigrationInterface, QueryRunner } from 'typeorm';

export class NetworkScanFbasProofMigration1783700000000 implements MigrationInterface {
	name = 'NetworkScanFbasProofMigration1783700000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "network_scan_fbas_proof" (
				"scan_id" integer NOT NULL,
				"scan_time" TIMESTAMP WITH TIME ZONE NOT NULL,
				"schema_version" smallint NOT NULL DEFAULT 1,
				"payload" jsonb NOT NULL,
				"payload_bytes" integer NOT NULL,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "PK_network_scan_fbas_proof_scan_id"
					PRIMARY KEY ("scan_id"),
				CONSTRAINT "CHK_network_scan_fbas_proof_schema_version"
					CHECK ("schema_version" = 1),
				CONSTRAINT "CHK_network_scan_fbas_proof_payload_bytes"
					CHECK ("payload_bytes" >= 0 AND "payload_bytes" <= 1000000),
				CONSTRAINT "FK_network_scan_fbas_proof_scan"
					FOREIGN KEY ("scan_id")
					REFERENCES "network_scan"("id")
					ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS
			"idx_network_scan_fbas_proof_scan_time"
			ON "network_scan_fbas_proof" ("scan_time")
		`);
		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS
			"idx_network_scan_fbas_proof_created_at"
			ON "network_scan_fbas_proof" ("created_at")
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			DROP INDEX IF EXISTS "idx_network_scan_fbas_proof_created_at"
		`);
		await queryRunner.query(`
			DROP INDEX IF EXISTS "idx_network_scan_fbas_proof_scan_time"
		`);
		await queryRunner.query(`
			DROP TABLE IF EXISTS "network_scan_fbas_proof"
		`);
	}
}
