import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
	createFullHistoryBatchProofExactTimestampFunctionSql,
	createFullHistoryBatchProofFunctionSql
} from './FullHistoryCanonicalSchemaSql.js';

export class FullHistoryProofTimestampPrecisionMigration1784910000000 implements MigrationInterface {
	name = 'FullHistoryProofTimestampPrecisionMigration1784910000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(createFullHistoryBatchProofFunctionSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			createFullHistoryBatchProofExactTimestampFunctionSql
		);
	}
}
