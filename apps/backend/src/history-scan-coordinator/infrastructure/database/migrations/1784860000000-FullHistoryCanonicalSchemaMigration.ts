import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
	createFullHistoryBatchImmutableTriggerSql,
	createFullHistoryBatchProofTriggerSql,
	createFullHistoryIngestionBatchSql,
	createFullHistoryLedgerSql,
	createFullHistoryReadIndexesSql,
	createFullHistoryTransactionResultSql,
	createFullHistoryTransactionSql,
	createFullHistoryVerifiedSourceFunctionSql,
	createFullHistoryWatermarkSql,
	createFullHistoryWatermarkTriggerSql,
	dropFullHistoryCanonicalSchemaSql
} from './FullHistoryCanonicalSchemaSql.js';

const migrationTimeouts = `
	set local lock_timeout = '2s';
	set local statement_timeout = '30s'
`;

export class FullHistoryCanonicalSchemaMigration1784860000000 implements MigrationInterface {
	name = 'FullHistoryCanonicalSchemaMigration1784860000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(createFullHistoryIngestionBatchSql);
		await queryRunner.query(createFullHistoryLedgerSql);
		await queryRunner.query(createFullHistoryTransactionSql);
		await queryRunner.query(createFullHistoryTransactionResultSql);
		await queryRunner.query(createFullHistoryWatermarkSql);
		await queryRunner.query(createFullHistoryReadIndexesSql);
		await queryRunner.query(createFullHistoryVerifiedSourceFunctionSql);
		await queryRunner.query(createFullHistoryBatchProofTriggerSql);
		await queryRunner.query(createFullHistoryBatchImmutableTriggerSql);
		await queryRunner.query(createFullHistoryWatermarkTriggerSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(dropFullHistoryCanonicalSchemaSql);
	}
}

function assertActiveTransaction(queryRunner: QueryRunner): void {
	if (!queryRunner.isTransactionActive) {
		throw new Error(
			'Full-history canonical schema migration requires an active transaction'
		);
	}
}
