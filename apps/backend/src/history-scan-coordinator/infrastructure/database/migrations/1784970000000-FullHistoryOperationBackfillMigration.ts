import type { MigrationInterface, QueryRunner } from 'typeorm';

const migrationTimeouts = `
	set local lock_timeout = '2s';
	set local statement_timeout = '30s'
`;

export class FullHistoryOperationBackfillMigration1784970000000 implements MigrationInterface {
	name = 'FullHistoryOperationBackfillMigration1784970000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(`
			alter table "full_history_operation_batch_coverage"
				add column "operation_decoder_version" varchar(128) not null
					default 'stellar-sdk-16/archive-xdr-v2-operation-facts';
			alter table "full_history_operation_batch_coverage"
				alter column "operation_decoder_version" drop default,
				add constraint "chk_full_history_operation_coverage_decoder" check (
					length(btrim("operation_decoder_version")) between 1 and 128
				)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(`
			alter table "full_history_operation_batch_coverage"
				drop constraint "chk_full_history_operation_coverage_decoder",
				drop column "operation_decoder_version"
		`);
	}
}

function assertActiveTransaction(queryRunner: QueryRunner): void {
	if (!queryRunner.isTransactionActive) {
		throw new Error(
			'Full-history operation backfill migration requires an active transaction'
		);
	}
}
