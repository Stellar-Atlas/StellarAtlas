import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScpStatementObservation1782890217100
	implements MigrationInterface
{
	name = 'ScpStatementObservation1782890217100';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "scp_statement_observation" (
				"id" SERIAL NOT NULL,
				"nodeId" text NOT NULL,
				"observedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
				"observedFromAddress" text NOT NULL,
				"observedFromPeer" text NOT NULL,
				"pledges" jsonb NOT NULL,
				"signature" text NOT NULL,
				"slotIndex" numeric NOT NULL,
				"statementHash" text NOT NULL,
				"statementType" text NOT NULL,
				"statementXdr" text NOT NULL,
				"values" jsonb NOT NULL,
				CONSTRAINT "PK_scp_statement_observation_id" PRIMARY KEY ("id"),
				CONSTRAINT "UQ_scp_statement_observation_statement_hash" UNIQUE ("statementHash")
			)
		`);
		await queryRunner.query(
			`CREATE INDEX "IDX_scp_statement_observation_observed_at" ON "scp_statement_observation" ("observedAt")`
		);
		await queryRunner.query(
			`CREATE INDEX "IDX_scp_statement_observation_node_slot_type" ON "scp_statement_observation" ("nodeId", "slotIndex", "statementType")`
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`DROP INDEX "IDX_scp_statement_observation_node_slot_type"`
		);
		await queryRunner.query(
			`DROP INDEX "IDX_scp_statement_observation_observed_at"`
		);
		await queryRunner.query(`DROP TABLE "scp_statement_observation"`);
	}
}
