import { OrganizationStellarTomlMigration1784300000000 } from '../1784300000000-OrganizationStellarTomlMigration.js';

describe('OrganizationStellarTomlMigration1784300000000', () => {
	let migration: OrganizationStellarTomlMigration1784300000000;
	let queryRunner: { query: jest.Mock };

	beforeEach(() => {
		migration = new OrganizationStellarTomlMigration1784300000000();
		queryRunner = { query: jest.fn() };
	});

	it('should add scanner-captured TOML text to organization snapshots', async () => {
		await migration.up(queryRunner as never);

		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('ALTER TABLE "organization_snap_shot"')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('ADD COLUMN IF NOT EXISTS "stellarTomlText" text')
		);
	});

	it('should drop scanner-captured TOML text from organization snapshots', async () => {
		await migration.down(queryRunner as never);

		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('DROP COLUMN IF EXISTS "stellarTomlText"')
		);
	});
});
