import { OrganizationTomlWarningsMigration1783900000000 } from '../1783900000000-OrganizationTomlWarningsMigration.js';

describe('OrganizationTomlWarningsMigration1783900000000', () => {
	let migration: OrganizationTomlWarningsMigration1783900000000;
	let queryRunner: { query: jest.Mock };

	beforeEach(() => {
		migration = new OrganizationTomlWarningsMigration1783900000000();
		queryRunner = { query: jest.fn() };
	});

	it('should add TOML warning evidence to organization measurements', async () => {
		await migration.up(queryRunner as never);

		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('ALTER TABLE "organization_measurement"')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"tomlWarnings" jsonb NOT NULL')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining("DEFAULT '[]'::jsonb")
		);
	});

	it('should drop TOML warning evidence from organization measurements', async () => {
		await migration.down(queryRunner as never);

		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('DROP COLUMN IF EXISTS "tomlWarnings"')
		);
	});
});
