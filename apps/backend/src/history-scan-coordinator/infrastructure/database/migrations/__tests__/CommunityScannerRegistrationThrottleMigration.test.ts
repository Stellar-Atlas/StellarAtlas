import { CommunityScannerRegistrationThrottleMigration1783500000000 } from '../1783500000000-CommunityScannerRegistrationThrottleMigration.js';

describe('CommunityScannerRegistrationThrottleMigration1783500000000', () => {
	let migration: CommunityScannerRegistrationThrottleMigration1783500000000;
	let queryRunner: { query: jest.Mock };

	beforeEach(() => {
		migration = new CommunityScannerRegistrationThrottleMigration1783500000000();
		queryRunner = { query: jest.fn() };
	});

	it('should create the registration throttle table and updated index', async () => {
		await migration.up(queryRunner as never);

		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'CREATE TABLE IF NOT EXISTS "community_scanner_registration_throttles"'
			)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"source_ip_hash" char(64) NOT NULL')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"attempt_count" integer NOT NULL DEFAULT 0')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'PRIMARY KEY ("source_ip_hash")'
			)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'"idx_community_scanner_registration_throttles_updated_at"'
			)
		);
	});

	it('should drop the registration throttle table and index', async () => {
		await migration.down(queryRunner as never);

		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('DROP INDEX IF EXISTS')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'"idx_community_scanner_registration_throttles_updated_at"'
			)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'DROP TABLE IF EXISTS "community_scanner_registration_throttles"'
			)
		);
	});
});
