import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
	createFullHistoryCanonicalCoverageGuardFunctionSql,
	createFullHistoryCanonicalCoverageGuardFunctionWithoutStateImportsSql
} from '../full-history-state-import/FullHistoryCanonicalCoverageGuardSql.js';

export class FullHistoryCanonicalCoverageDecouplingMigration1785390000000 implements MigrationInterface {
	readonly name =
		'FullHistoryCanonicalCoverageDecouplingMigration1785390000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			createFullHistoryCanonicalCoverageGuardFunctionWithoutStateImportsSql
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(createFullHistoryCanonicalCoverageGuardFunctionSql);
	}
}
