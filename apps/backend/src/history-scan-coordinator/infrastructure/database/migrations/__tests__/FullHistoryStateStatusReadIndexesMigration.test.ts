import { mock, type MockProxy } from 'jest-mock-extended';
import type { QueryRunner } from 'typeorm';
import { FullHistoryStateStatusReadIndexesMigration1785150000000 } from '../1785150000000-FullHistoryStateStatusReadIndexesMigration.js';

describe('FullHistoryStateStatusReadIndexesMigration1785150000000', () => {
	let migration: FullHistoryStateStatusReadIndexesMigration1785150000000;
	let queryRunner: MockProxy<QueryRunner>;

	beforeEach(() => {
		migration = new FullHistoryStateStatusReadIndexesMigration1785150000000();
		queryRunner = mock<QueryRunner>();
		Object.defineProperty(queryRunner, 'isTransactionActive', {
			configurable: true,
			value: true
		});
	});

	it('creates network-leading covering indexes for the bounded status lane', async () => {
		await migration.up(queryRunner);

		expect(queryRunner.query).toHaveBeenCalledTimes(2);
		const sql = String(queryRunner.query.mock.calls[1]?.[0]);
		expect(sql).toContain('idx_full_history_lcm_batch_status_network');
		expect(sql).toContain('network_passphrase_hash", "id');
		expect(sql).toContain('idx_full_history_lcm_state_import_status_read');
		expect(sql).toContain('include ("completed_at", "updated_at")');
		expect(sql).toContain('idx_full_history_lcm_state_coverage_status_read');
		expect(sql).toContain('"network_passphrase_hash", "status"');
	});

	it('refuses to run outside a managed migration transaction', async () => {
		Object.defineProperty(queryRunner, 'isTransactionActive', {
			configurable: true,
			value: false
		});

		await expect(migration.up(queryRunner)).rejects.toThrow(
			'requires a transaction'
		);
		expect(queryRunner.query).not.toHaveBeenCalled();
	});
});
