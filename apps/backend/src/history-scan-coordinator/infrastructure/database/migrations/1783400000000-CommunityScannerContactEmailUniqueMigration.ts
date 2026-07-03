import { MigrationInterface, QueryRunner } from 'typeorm';

export class CommunityScannerContactEmailUniqueMigration1783400000000 implements MigrationInterface {
	name = 'CommunityScannerContactEmailUniqueMigration1783400000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS
			"idx_community_scanners_contact_email_unique"
			ON "community_scanners" ("contact_email")
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			DROP INDEX IF EXISTS
			"idx_community_scanners_contact_email_unique"
		`);
	}
}
