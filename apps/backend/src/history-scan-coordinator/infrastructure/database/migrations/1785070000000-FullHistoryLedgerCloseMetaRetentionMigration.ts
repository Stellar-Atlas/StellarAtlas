import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
	createFullHistoryLedgerCloseMetaRetentionSchemaSql,
	dropFullHistoryLedgerCloseMetaRetentionSchemaSql
} from './FullHistoryLedgerCloseMetaRetentionSchemaSql.js';

const migrationTimeouts = `
	set local lock_timeout = '2s';
	set local statement_timeout = '30s'
`;

export class FullHistoryLedgerCloseMetaRetentionMigration1785070000000 implements MigrationInterface {
	readonly name = 'FullHistoryLedgerCloseMetaRetentionMigration1785070000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(createFullHistoryLedgerCloseMetaRetentionSchemaSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(dropFullHistoryLedgerCloseMetaRetentionSchemaSql);
	}
}

function assertActiveTransaction(queryRunner: QueryRunner): void {
	if (!queryRunner.isTransactionActive) {
		throw new Error(
			'Full-history LedgerCloseMeta retention migration requires an active transaction'
		);
	}
}
