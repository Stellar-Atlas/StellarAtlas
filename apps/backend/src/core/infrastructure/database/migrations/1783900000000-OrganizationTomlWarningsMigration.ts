import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrganizationTomlWarningsMigration1783900000000 implements MigrationInterface {
	name = 'OrganizationTomlWarningsMigration1783900000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE "organization_measurement"
			ADD COLUMN IF NOT EXISTS "tomlWarnings" jsonb NOT NULL DEFAULT '[]'::jsonb
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE "organization_measurement"
			DROP COLUMN IF EXISTS "tomlWarnings"
		`);
	}
}
