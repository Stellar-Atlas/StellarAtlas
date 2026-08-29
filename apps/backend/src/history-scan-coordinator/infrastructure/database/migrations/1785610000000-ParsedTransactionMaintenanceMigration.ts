import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ParsedTransactionMaintenanceMigration1785610000000 implements MigrationInterface {
	name = 'ParsedTransactionMaintenanceMigration1785610000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			set local lock_timeout = '10s';
			alter table parsed_transaction_envelope set (
				autovacuum_vacuum_scale_factor = 0.05,
				autovacuum_vacuum_threshold = 1000000,
				autovacuum_vacuum_insert_scale_factor = 0.10,
				autovacuum_vacuum_insert_threshold = 1000000,
				autovacuum_analyze_scale_factor = 0.05,
				autovacuum_analyze_threshold = 1000000
			);
			alter table parsed_transaction_result set (
				autovacuum_vacuum_scale_factor = 0.05,
				autovacuum_vacuum_threshold = 1000000,
				autovacuum_vacuum_insert_scale_factor = 0.10,
				autovacuum_vacuum_insert_threshold = 1000000,
				autovacuum_analyze_scale_factor = 0.05,
				autovacuum_analyze_threshold = 1000000
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			set local lock_timeout = '10s';
			alter table parsed_transaction_envelope reset (
				autovacuum_vacuum_scale_factor,
				autovacuum_vacuum_threshold,
				autovacuum_vacuum_insert_scale_factor,
				autovacuum_vacuum_insert_threshold,
				autovacuum_analyze_scale_factor,
				autovacuum_analyze_threshold
			);
			alter table parsed_transaction_result reset (
				autovacuum_vacuum_scale_factor,
				autovacuum_vacuum_threshold,
				autovacuum_vacuum_insert_scale_factor,
				autovacuum_vacuum_insert_threshold,
				autovacuum_analyze_scale_factor,
				autovacuum_analyze_threshold
			)
		`);
	}
}
