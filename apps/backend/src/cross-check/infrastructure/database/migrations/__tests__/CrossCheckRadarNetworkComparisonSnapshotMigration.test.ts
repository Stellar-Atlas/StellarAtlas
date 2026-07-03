import { CrossCheckRadarNetworkComparisonSnapshotMigration1783800000000 } from '../1783800000000-CrossCheckRadarNetworkComparisonSnapshotMigration.js';

describe('CrossCheckRadarNetworkComparisonSnapshotMigration1783800000000', () => {
	let migration: CrossCheckRadarNetworkComparisonSnapshotMigration1783800000000;
	let queryRunner: { query: jest.Mock };

	beforeEach(() => {
		migration =
			new CrossCheckRadarNetworkComparisonSnapshotMigration1783800000000();
		queryRunner = { query: jest.fn() };
	});

	it('should create the RADAR network snapshot table and indexes', async () => {
		await migration.up(queryRunner as never);

		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'CREATE TABLE IF NOT EXISTS "cross_check_radar_network_comparison_snapshots"'
			)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"id" uuid NOT NULL DEFAULT gen_random_uuid()')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"status" varchar(32) NOT NULL')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'"generated_at" TIMESTAMP WITH TIME ZONE NOT NULL'
			)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"comparison" jsonb')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"failure" jsonb')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'"stored_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()'
			)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'"CHK_cross_check_radar_network_snapshots_status"'
			)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'"CHK_cross_check_radar_network_snapshots_payload"'
			)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'"idx_cross_check_radar_network_snapshots_latest"'
			)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'"idx_cross_check_radar_network_status_generated_at"'
			)
		);
	});

	it('should drop the RADAR network snapshot table and indexes', async () => {
		await migration.down(queryRunner as never);

		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'"idx_cross_check_radar_network_status_generated_at"'
			)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'"idx_cross_check_radar_network_snapshots_latest"'
			)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'DROP TABLE IF EXISTS "cross_check_radar_network_comparison_snapshots"'
			)
		);
	});
});
