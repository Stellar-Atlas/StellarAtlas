import type { MigrationInterface, QueryRunner } from 'typeorm';
import { createFullHistoryCanonicalCoverageGuardFunctionSql } from '../full-history-state-import/FullHistoryCanonicalCoverageGuardSql.js';

export class FullHistoryCurrentProofCoverageMigration1785190000000 implements MigrationInterface {
	readonly name = 'FullHistoryCurrentProofCoverageMigration1785190000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`set local lock_timeout = '2s'`);
		await queryRunner.query(`set local statement_timeout = '30s'`);
		await queryRunner.query(createFullHistoryCanonicalCoverageGuardFunctionSql);
	}

	async down(_queryRunner: QueryRunner): Promise<void> {
		// Current strict proof attestation must not be weakened on rollback.
	}
}
