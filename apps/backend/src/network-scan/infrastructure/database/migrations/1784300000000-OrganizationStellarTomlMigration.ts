import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrganizationStellarTomlMigration1784300000000 implements MigrationInterface {
	name = 'OrganizationStellarTomlMigration1784300000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE "organization_snap_shot"
			ADD COLUMN IF NOT EXISTS "stellarTomlText" text
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE "organization_snap_shot"
			DROP COLUMN IF EXISTS "stellarTomlText"
		`);
	}
}
