import { NetworkScanFbasProofMigration1783700000000 } from '../1783700000000-NetworkScanFbasProofMigration.js';

describe('NetworkScanFbasProofMigration1783700000000', () => {
	let migration: NetworkScanFbasProofMigration1783700000000;
	let queryRunner: { query: jest.Mock };

	beforeEach(() => {
		migration = new NetworkScanFbasProofMigration1783700000000();
		queryRunner = { query: jest.fn() };
	});

	it('should create the FBAS proof table and indexes', async () => {
		await migration.up(queryRunner as never);

		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'CREATE TABLE IF NOT EXISTS "network_scan_fbas_proof"'
			)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"scan_id" integer NOT NULL')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"payload" jsonb NOT NULL')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"payload_bytes" integer NOT NULL')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"CHK_network_scan_fbas_proof_payload_bytes"')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"FK_network_scan_fbas_proof_scan"')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"idx_network_scan_fbas_proof_scan_time"')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"idx_network_scan_fbas_proof_created_at"')
		);
	});

	it('should drop the FBAS proof table and indexes', async () => {
		await migration.down(queryRunner as never);

		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"idx_network_scan_fbas_proof_created_at"')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('"idx_network_scan_fbas_proof_scan_time"')
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('DROP TABLE IF EXISTS "network_scan_fbas_proof"')
		);
	});
});
