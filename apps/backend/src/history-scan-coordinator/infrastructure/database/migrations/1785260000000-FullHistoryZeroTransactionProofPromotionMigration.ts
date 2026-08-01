import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
	createFullHistoryBatchProofCurrentFunctionSql,
	createFullHistoryBatchProofExactTimestampFunctionSql
} from './FullHistoryCanonicalSchemaSql.js';

export class FullHistoryZeroTransactionProofPromotionMigration1785260000000 implements MigrationInterface {
	readonly name =
		'FullHistoryZeroTransactionProofPromotionMigration1785260000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(createFullHistoryBatchProofCurrentFunctionSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			createFullHistoryBatchProofExactTimestampFunctionSql
		);
	}
}
