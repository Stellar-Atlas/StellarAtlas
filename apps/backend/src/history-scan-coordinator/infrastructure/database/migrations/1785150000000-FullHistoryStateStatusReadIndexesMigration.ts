import type { MigrationInterface, QueryRunner } from 'typeorm';

const migrationTimeouts = `
	set local lock_timeout = '2s';
	set local statement_timeout = '30s'
`;

export class FullHistoryStateStatusReadIndexesMigration1785150000000 implements MigrationInterface {
	readonly name = 'FullHistoryStateStatusReadIndexesMigration1785150000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(`
			create index "idx_full_history_lcm_batch_status_network"
				on "full_history_ledger_close_meta_batch" (
					"network_passphrase_hash", "id"
				);
			create index "idx_full_history_lcm_state_import_status_read"
				on "full_history_lcm_state_import" (
					"batch_id", "dataset", "status"
				) include ("completed_at", "updated_at");
			create index "idx_full_history_lcm_state_coverage_status_read"
				on "full_history_lcm_state_canonical_coverage" (
					"network_passphrase_hash", "status"
				) include (
					"expected_ledger_count", "matched_ledger_count",
					"completed_at", "updated_at"
				)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(`
			drop index "idx_full_history_lcm_state_coverage_status_read";
			drop index "idx_full_history_lcm_state_import_status_read";
			drop index "idx_full_history_lcm_batch_status_network"
		`);
	}
}

function assertActiveTransaction(queryRunner: QueryRunner): void {
	if (!queryRunner.isTransactionActive) {
		throw new Error(
			'Full-history status index migration requires a transaction'
		);
	}
}
