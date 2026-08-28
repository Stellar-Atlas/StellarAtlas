import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
	allowFullHistoryLedgerTwoBootstrapSql,
	restoreFullHistoryLedgerCloseMetaRangeSql
} from './FullHistoryLedgerTwoBootstrapSql.js';

const migrationTimeouts = `
	set local lock_timeout = '2s';
	set local statement_timeout = '30s'
`;

export class FullHistoryLedgerTwoBootstrapMigration1785600000000 implements MigrationInterface {
	readonly name = 'FullHistoryLedgerTwoBootstrapMigration1785600000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(allowFullHistoryLedgerTwoBootstrapSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(restoreFullHistoryLedgerCloseMetaRangeSql);
	}
}

function assertActiveTransaction(queryRunner: QueryRunner): void {
	if (!queryRunner.isTransactionActive) {
		throw new Error(
			'Full-history ledger-two bootstrap migration requires an active transaction'
		);
	}
}
