import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
	createHistoryArchiveBrokerCandidateProjectionSchemaSql,
	dropHistoryArchiveBrokerCandidateProjectionSql
} from '../../repositories/database/HistoryArchiveBrokerCandidateProjection.js';

export class HistoryArchiveBrokerCandidateProjectionMigration1791182400000 implements MigrationInterface {
	name = 'HistoryArchiveBrokerCandidateProjectionMigration1791182400000';
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			createHistoryArchiveBrokerCandidateProjectionSchemaSql(
				process.env.HISTORY_ARCHIVE_BROKER_CANDIDATE_TABLESPACE
			)
		);
	}
	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(dropHistoryArchiveBrokerCandidateProjectionSql);
	}
}
