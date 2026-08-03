import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveEventSummaryMaintenanceMigration1785360000000
	implements MigrationInterface
{
	name = 'HistoryArchiveEventSummaryMaintenanceMigration1785360000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			set local lock_timeout = '2s';
			set local statement_timeout = '30s'
		`);
		await queryRunner.query(`
			alter table history_archive_object_event_summary set (
				fillfactor = 70,
				autovacuum_vacuum_scale_factor = 0,
				autovacuum_vacuum_threshold = 10000,
				autovacuum_analyze_scale_factor = 0,
				autovacuum_analyze_threshold = 10000
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			set local lock_timeout = '2s';
			set local statement_timeout = '30s'
		`);
		await queryRunner.query(`
			alter table history_archive_object_event_summary reset (
				fillfactor,
				autovacuum_vacuum_scale_factor,
				autovacuum_vacuum_threshold,
				autovacuum_analyze_scale_factor,
				autovacuum_analyze_threshold
			)
		`);
	}
}
