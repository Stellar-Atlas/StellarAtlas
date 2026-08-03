import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveHotTableMaintenanceMigration1785350000000
	implements MigrationInterface
{
	name = 'HistoryArchiveHotTableMaintenanceMigration1785350000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			set local lock_timeout = '2s';
			set local statement_timeout = '30s'
		`);
		await queryRunner.query(`
			alter table history_archive_object_ready set (
				fillfactor = 70,
				autovacuum_vacuum_scale_factor = 0,
				autovacuum_vacuum_threshold = 10000,
				autovacuum_analyze_scale_factor = 0,
				autovacuum_analyze_threshold = 10000
			);
			alter table history_archive_object_claim_slot set (
				autovacuum_vacuum_threshold = 10000,
				autovacuum_analyze_threshold = 10000
			);
			alter table history_archive_evidence_root_summary set (
				fillfactor = 70,
				autovacuum_vacuum_scale_factor = 0,
				autovacuum_vacuum_threshold = 10000,
				autovacuum_analyze_scale_factor = 0,
				autovacuum_analyze_threshold = 10000
			);
			alter table history_archive_object_type_summary set (
				fillfactor = 70,
				autovacuum_vacuum_scale_factor = 0,
				autovacuum_vacuum_threshold = 10000,
				autovacuum_analyze_scale_factor = 0,
				autovacuum_analyze_threshold = 10000
			);
			alter table history_archive_state_snapshot set (
				fillfactor = 70,
				autovacuum_vacuum_scale_factor = 0,
				autovacuum_vacuum_threshold = 1000,
				autovacuum_analyze_scale_factor = 0,
				autovacuum_analyze_threshold = 1000
			);
			alter table history_archive_checkpoint_proof_rollup set (
				fillfactor = 70,
				autovacuum_vacuum_scale_factor = 0,
				autovacuum_vacuum_threshold = 1000,
				autovacuum_analyze_scale_factor = 0,
				autovacuum_analyze_threshold = 1000
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			set local lock_timeout = '2s';
			set local statement_timeout = '30s'
		`);
		await queryRunner.query(`
			alter table history_archive_object_ready reset (
				fillfactor,
				autovacuum_vacuum_scale_factor,
				autovacuum_vacuum_threshold,
				autovacuum_analyze_scale_factor,
				autovacuum_analyze_threshold
			);
			alter table history_archive_object_claim_slot set (
				autovacuum_vacuum_threshold = 1000,
				autovacuum_analyze_threshold = 1000
			);
			alter table history_archive_evidence_root_summary reset (
				fillfactor,
				autovacuum_vacuum_scale_factor,
				autovacuum_vacuum_threshold,
				autovacuum_analyze_scale_factor,
				autovacuum_analyze_threshold
			);
			alter table history_archive_object_type_summary reset (
				fillfactor,
				autovacuum_vacuum_scale_factor,
				autovacuum_vacuum_threshold,
				autovacuum_analyze_scale_factor,
				autovacuum_analyze_threshold
			);
			alter table history_archive_state_snapshot reset (
				fillfactor,
				autovacuum_vacuum_scale_factor,
				autovacuum_vacuum_threshold,
				autovacuum_analyze_scale_factor,
				autovacuum_analyze_threshold
			);
			alter table history_archive_checkpoint_proof_rollup reset (
				fillfactor,
				autovacuum_vacuum_scale_factor,
				autovacuum_vacuum_threshold,
				autovacuum_analyze_scale_factor,
				autovacuum_analyze_threshold
			)
		`);
	}
}
