import { MigrationInterface, type QueryRunner } from 'typeorm';

export class FullHistoryPromotionRuntimeMigration1784930000000 implements MigrationInterface {
	name = 'FullHistoryPromotionRuntimeMigration1784930000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table "full_history_promotion_runtime" (
				"network_passphrase_hash" bytea primary key,
				"instance_id" uuid not null,
				state text not null,
				"checkpoint_ledger" bigint,
				"next_ledger" bigint,
				"last_outcome" text,
				"last_error_code" varchar(64),
				"started_at" timestamptz not null,
				"heartbeat_at" timestamptz not null,
				"last_attempt_at" timestamptz,
				"last_success_at" timestamptz,
				"last_failure_at" timestamptz,
				"updated_at" timestamptz not null default now(),
				constraint "chk_full_history_promotion_runtime_hash"
					check (octet_length("network_passphrase_hash") = 32),
				constraint "chk_full_history_promotion_runtime_state"
					check (state in (
						'failed', 'promoting', 'running', 'stopped',
						'waiting-for-proof'
					)),
				constraint "chk_full_history_promotion_runtime_outcome"
					check ("last_outcome" is null or "last_outcome" in (
						'bootstrap-required', 'proof-pending', 'promoted', 'replayed'
					)),
				constraint "chk_full_history_promotion_runtime_checkpoint"
					check ("checkpoint_ledger" is null or
						"checkpoint_ledger" between 0 and 4294967295),
				constraint "chk_full_history_promotion_runtime_next"
					check ("next_ledger" is null or
						"next_ledger" between 0 and 4294967296)
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			'drop table if exists "full_history_promotion_runtime"'
		);
	}
}
