import type { MigrationInterface, QueryRunner } from 'typeorm';

export const historyArchiveQueueVacuumPolicySql =
	'alter table history_archive_object_queue set (' +
	'autovacuum_vacuum_scale_factor = 0.05, ' +
	'autovacuum_vacuum_threshold = 100000' +
	')';

export const historyArchiveQueueVacuumPolicyResetSql =
	'alter table history_archive_object_queue reset (' +
	'autovacuum_vacuum_scale_factor, ' +
	'autovacuum_vacuum_threshold' +
	')';

export class HistoryArchiveQueueVacuumPolicyMigration1788160000000 implements MigrationInterface {
	readonly name = 'HistoryArchiveQueueVacuumPolicyMigration1788160000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(historyArchiveQueueVacuumPolicySql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(historyArchiveQueueVacuumPolicyResetSql);
	}
}
