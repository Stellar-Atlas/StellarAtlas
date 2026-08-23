import type { MigrationInterface, QueryRunner } from 'typeorm';
import { checkpointProofRollupStatementUpdateFunctionSql } from './1785580000000-HistoryArchiveCheckpointProofStatementRollupMigration.js';

export class HistoryArchiveCheckpointProofStatementRollupCorrectionMigration1785590000000 implements MigrationInterface {
	readonly name =
		'HistoryArchiveCheckpointProofStatementRollupCorrectionMigration1785590000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("set local lock_timeout = '5s'");
		await queryRunner.query(checkpointProofRollupStatementUpdateFunctionSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(checkpointProofRollupStatementUpdateFunctionSql);
	}
}
