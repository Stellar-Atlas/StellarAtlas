import type { MigrationInterface, QueryRunner } from 'typeorm';
import { historyArchiveRootFailureControlSchemaSql } from '../../repositories/database/HistoryArchiveRootFailureControl.js';

export class HistoryArchiveRootFailureControlMigration1791096000000 implements MigrationInterface {
	name = 'HistoryArchiveRootFailureControlMigration1791096000000';
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(historyArchiveRootFailureControlSchemaSql);
	}
	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`do $$ begin
      if exists(select 1 from history_archive_root_failure_control limit 1) then
        raise exception 'Refusing to remove persisted archive failure/adaptive control state';
      end if;
    end $$`);
		await queryRunner.query('drop table history_archive_root_failure_control');
	}
}
