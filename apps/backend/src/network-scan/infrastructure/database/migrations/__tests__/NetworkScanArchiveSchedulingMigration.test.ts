import { NetworkScanArchiveSchedulingMigration1784320000000 } from '../1784320000000-NetworkScanArchiveSchedulingMigration.js';

describe('NetworkScanArchiveSchedulingMigration1784320000000', () => {
	let migration: NetworkScanArchiveSchedulingMigration1784320000000;
	let queryRunner: { query: jest.Mock };

	beforeEach(() => {
		migration = new NetworkScanArchiveSchedulingMigration1784320000000();
		queryRunner = { query: jest.fn() };
	});

	it('should add archive scheduling counters to network scans', async () => {
		await migration.up(queryRunner as never);

		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('alter table "network_scan"')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"historyArchiveSchedulingDiscoveredUrlCount"')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'"historyArchiveSchedulingDuplicateSuppressedCount"'
			)
		);
	});

	it('should drop archive scheduling counters from network scans', async () => {
		await migration.down(queryRunner as never);

		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'drop column if exists "historyArchiveSchedulingErrorCount"'
			)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"historyArchiveSchedulingDiscoveredUrlCount"')
		);
	});
});
