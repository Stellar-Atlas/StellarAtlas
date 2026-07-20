import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FullHistoryLedgerCloseMetaStatusRollupMigration1785220000000 implements MigrationInterface {
	readonly name =
		'FullHistoryLedgerCloseMetaStatusRollupMigration1785220000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table "full_history_lcm_dataset_status_rollup" (
				"network_passphrase_hash" bytea not null,
				"dataset" varchar(64) not null,
				"schema_version" varchar(64) not null,
				"batch_count" bigint not null,
				"record_count" numeric(40, 0) not null,
				"output_bytes" numeric(40, 0) not null,
				"updated_at" timestamptz not null default now(),
				constraint "pk_full_history_lcm_dataset_status_rollup"
					primary key (
						"network_passphrase_hash", "dataset", "schema_version"
					),
				constraint "chk_full_history_lcm_dataset_status_rollup" check (
					octet_length("network_passphrase_hash") = 32
					and "batch_count" >= 0
					and "record_count" >= 0
					and "output_bytes" >= 0
				)
			)
		`);
		await queryRunner.query(`
			create or replace function
				"increment_full_history_lcm_dataset_status_rollup"()
			returns trigger
			language plpgsql
			as $$
			begin
				insert into "full_history_lcm_dataset_status_rollup" (
					"network_passphrase_hash", "dataset", "schema_version",
					"batch_count", "record_count", "output_bytes", "updated_at"
				) values (
					new."network_passphrase_hash", new."dataset",
					new."schema_version", 1, new."record_count",
					new."output_bytes", now()
				)
				on conflict (
					"network_passphrase_hash", "dataset", "schema_version"
				) do update set
					"batch_count" =
						"full_history_lcm_dataset_status_rollup"."batch_count" + 1,
					"record_count" =
						"full_history_lcm_dataset_status_rollup"."record_count" +
						excluded."record_count",
					"output_bytes" =
						"full_history_lcm_dataset_status_rollup"."output_bytes" +
						excluded."output_bytes",
					"updated_at" = now();
				return new;
			end
			$$
		`);
		await queryRunner.query(`
			create trigger "trg_full_history_lcm_dataset_status_rollup"
			after insert on "full_history_ledger_close_meta_dataset"
			for each row execute function
				"increment_full_history_lcm_dataset_status_rollup"()
		`);
		await queryRunner.query(`
			insert into "full_history_lcm_dataset_status_rollup" (
				"network_passphrase_hash", "dataset", "schema_version",
				"batch_count", "record_count", "output_bytes", "updated_at"
			)
			select "network_passphrase_hash", "dataset", "schema_version",
				count(*)::bigint, sum("record_count")::numeric,
				sum("output_bytes")::numeric, now()
			from "full_history_ledger_close_meta_dataset"
			group by "network_passphrase_hash", "dataset", "schema_version"
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop trigger if exists
				"trg_full_history_lcm_dataset_status_rollup"
			on "full_history_ledger_close_meta_dataset"
		`);
		await queryRunner.query(`
			drop function if exists
				"increment_full_history_lcm_dataset_status_rollup"()
		`);
		await queryRunner.query(`
			drop table if exists "full_history_lcm_dataset_status_rollup"
		`);
	}
}
