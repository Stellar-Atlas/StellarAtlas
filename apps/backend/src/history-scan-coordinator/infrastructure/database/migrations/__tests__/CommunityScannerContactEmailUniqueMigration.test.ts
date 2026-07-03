import { CommunityScannerContactEmailUniqueMigration1783400000000 } from '../1783400000000-CommunityScannerContactEmailUniqueMigration.js';

describe('CommunityScannerContactEmailUniqueMigration1783400000000', () => {
	let migration: CommunityScannerContactEmailUniqueMigration1783400000000;
	let queryRunner: { query: jest.Mock };

	beforeEach(() => {
		migration = new CommunityScannerContactEmailUniqueMigration1783400000000();
		queryRunner = { query: jest.fn() };
	});

	it('should create the unique contact email index', async () => {
		await migration.up(queryRunner as never);

		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('CREATE UNIQUE INDEX IF NOT EXISTS')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"idx_community_scanners_contact_email_unique"')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('ON "community_scanners" ("contact_email")')
		);
	});

	it('should drop the unique contact email index', async () => {
		await migration.down(queryRunner as never);

		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('DROP INDEX IF EXISTS')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"idx_community_scanners_contact_email_unique"')
		);
	});
});
