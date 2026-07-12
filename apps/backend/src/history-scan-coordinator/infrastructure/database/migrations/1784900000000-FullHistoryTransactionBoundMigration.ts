import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FullHistoryTransactionBoundMigration1784900000000 implements MigrationInterface {
	name = 'FullHistoryTransactionBoundMigration1784900000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await replaceCheckpointCountConstraint(queryRunner, 100_000);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await replaceCheckpointCountConstraint(queryRunner, 10_000);
	}
}

async function replaceCheckpointCountConstraint(
	queryRunner: QueryRunner,
	maximumTransactionCount: number
): Promise<void> {
	await queryRunner.query(`
		alter table "full_history_ingestion_batch"
			drop constraint if exists "chk_full_history_batch_counts",
			add constraint "chk_full_history_batch_counts" check (
				"ledger_count" = case
					when "checkpoint_ledger" = 63 then 63 else 64
				end
				and "transaction_count" between 0 and ${maximumTransactionCount}
				and "result_count" = "transaction_count"
			) not valid
	`);
	await queryRunner.query(`
		alter table "full_history_ingestion_batch"
			validate constraint "chk_full_history_batch_counts"
	`);
}
