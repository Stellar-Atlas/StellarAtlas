import type { MigrationInterface, QueryRunner } from 'typeorm';

const migrationTimeouts = `
	set local lock_timeout = '2s';
	set local statement_timeout = '30s'
`;

export class FullHistoryHistoricalBackfillMigration1784940000000 implements MigrationInterface {
	name = 'FullHistoryHistoricalBackfillMigration1784940000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(addHistoricalFrontierColumnsSql);
		await queryRunner.query(createBidirectionalWatermarkFunctionSql);
		await queryRunner.query(backfillHistoricalFrontierSql);
		await queryRunner.query(createHistoricalBackfillJobSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(
			'drop table "full_history_historical_backfill_job"'
		);
		await queryRunner.query(createForwardOnlyWatermarkFunctionSql);
		await queryRunner.query(dropHistoricalFrontierSql);
	}
}

const addHistoricalFrontierColumnsSql = `
	alter table "full_history_watermark"
		add column "first_ledger" bigint,
		add column "first_batch_id" uuid
`;

const backfillHistoricalFrontierSql = `
	with earliest_batch as (
		select distinct on (batch."network_passphrase_hash")
			batch."network_passphrase_hash", batch."first_ledger", batch.id
		from "full_history_ingestion_batch" batch
		join "full_history_watermark" watermark
			on watermark."network_passphrase_hash" =
				batch."network_passphrase_hash"
		order by batch."network_passphrase_hash", batch."first_ledger", batch.id
	)
	update "full_history_watermark" watermark
	set "first_ledger" = earliest."first_ledger",
		"first_batch_id" = earliest.id
	from earliest_batch earliest
	where earliest."network_passphrase_hash" =
		watermark."network_passphrase_hash";

	alter table "full_history_watermark"
		alter column "first_ledger" set not null,
		alter column "first_batch_id" set not null,
		add constraint "uq_full_history_watermark_first_batch"
			unique ("first_batch_id"),
		add constraint "fk_full_history_watermark_first_batch"
			foreign key ("first_batch_id", "network_passphrase_hash")
			references "full_history_ingestion_batch"
				("id", "network_passphrase_hash") on delete restrict,
		add constraint "chk_full_history_watermark_first" check (
			"first_ledger" between 1 and 4294967295
			and "first_ledger" < "next_ledger"
		);
`;

const createHistoricalBackfillJobSql = `
	create table "full_history_historical_backfill_job" (
		"id" uuid not null,
		"network_passphrase_hash" bytea not null,
		"first_checkpoint_ledger" bigint not null,
		"last_checkpoint_ledger" bigint not null,
		"state" text not null default 'pending',
		"attempt_count" smallint not null default 0,
		"max_attempts" smallint not null default 8,
		"available_at" timestamptz not null default now(),
		"lease_owner" uuid,
		"lease_token" uuid,
		"lease_expires_at" timestamptz,
		"last_error_code" varchar(64),
		"completed_at" timestamptz,
		"created_at" timestamptz not null default now(),
		"updated_at" timestamptz not null default now(),
		constraint "pk_full_history_historical_backfill_job" primary key ("id"),
		constraint "uq_full_history_historical_backfill_range" unique (
			"network_passphrase_hash", "first_checkpoint_ledger",
			"last_checkpoint_ledger"
		),
		constraint "fk_full_history_historical_backfill_network"
			foreign key ("network_passphrase_hash")
			references "full_history_watermark" ("network_passphrase_hash")
			on delete restrict,
		constraint "chk_full_history_historical_backfill_hash"
			check (octet_length("network_passphrase_hash") = 32),
		constraint "chk_full_history_historical_backfill_range" check (
			"first_checkpoint_ledger" between 63 and 4294967295
			and "last_checkpoint_ledger" between 63 and 4294967295
			and mod("first_checkpoint_ledger", 64) = 63
			and mod("last_checkpoint_ledger", 64) = 63
			and "last_checkpoint_ledger" >= "first_checkpoint_ledger"
			and ("last_checkpoint_ledger" - "first_checkpoint_ledger") / 64
				between 0 and 7
		),
		constraint "chk_full_history_historical_backfill_attempts" check (
			"max_attempts" between 1 and 32767
			and "attempt_count" between 0 and "max_attempts"
		),
		constraint "chk_full_history_historical_backfill_error" check (
			"last_error_code" is null
			or "last_error_code" ~ '^[a-z][a-z0-9-]{0,63}$'
		),
		constraint "chk_full_history_historical_backfill_lifecycle" check (
			("state" = 'pending' and "lease_owner" is null
				and "lease_token" is null and "lease_expires_at" is null
				and "completed_at" is null)
			or ("state" = 'leased' and "lease_owner" is not null
				and "lease_token" is not null and "lease_expires_at" is not null
				and "completed_at" is null)
			or ("state" = 'completed' and "lease_owner" is null
				and "lease_token" is null and "lease_expires_at" is null
				and "completed_at" is not null)
			or ("state" = 'failed' and "lease_owner" is null
				and "lease_token" is null and "lease_expires_at" is null
				and "completed_at" is null)
		)
	);

	create index "idx_full_history_historical_backfill_claim"
		on "full_history_historical_backfill_job" (
			"network_passphrase_hash", "last_checkpoint_ledger" desc,
			"available_at", "created_at"
		) where "state" = 'pending';
	create index "idx_full_history_historical_backfill_expired_lease"
		on "full_history_historical_backfill_job" (
			"network_passphrase_hash", "lease_expires_at",
			"last_checkpoint_ledger" desc
		) where "state" = 'leased';
	create unique index "uq_full_history_historical_backfill_worker_lease"
		on "full_history_historical_backfill_job" (
			"network_passphrase_hash", "lease_owner"
		)
		where "state" = 'leased';
`;

const createBidirectionalWatermarkFunctionSql = `
	create or replace function validate_full_history_watermark_advance()
	returns trigger
	language plpgsql
	as $function$
	declare
		covered_batches integer;
		covered_first bigint;
		covered_last bigint;
		covered_ledgers numeric;
	begin
		if tg_op = 'DELETE' then
			raise exception 'full-history watermark deletion is prohibited'
				using errcode = '55000';
		end if;

		if tg_op = 'INSERT' then
			if new."first_ledger" is null or new."first_batch_id" is null then
				select batch."first_ledger", batch.id
				into new."first_ledger", new."first_batch_id"
				from "full_history_ingestion_batch" batch
				where batch.id = new."last_batch_id"
					and batch."network_passphrase_hash" =
						new."network_passphrase_hash";
			end if;
			if not exists (
				select 1 from "full_history_ingestion_batch" batch
				where batch.id = new."last_batch_id"
					and batch."network_passphrase_hash" =
						new."network_passphrase_hash"
					and batch."last_ledger" + 1 = new."next_ledger"
			) or not exists (
				select 1 from "full_history_ingestion_batch" batch
				where batch.id = new."first_batch_id"
					and batch."network_passphrase_hash" =
						new."network_passphrase_hash"
					and batch."first_ledger" = new."first_ledger"
			) then
				raise exception 'full-history watermark has no committed frontier batch'
					using errcode = '23514';
			end if;
			return new;
		end if;

		if new."network_passphrase_hash" <> old."network_passphrase_hash" then
			raise exception 'full-history watermark network is immutable'
				using errcode = '23514';
		end if;

		if old."first_ledger" is null and old."first_batch_id" is null
			and new."first_ledger" is not null
			and new."first_batch_id" is not null
			and new."next_ledger" = old."next_ledger"
			and new."last_batch_id" = old."last_batch_id"
			and exists (
				select 1 from "full_history_ingestion_batch" batch
				where batch.id = new."first_batch_id"
					and batch."network_passphrase_hash" =
						new."network_passphrase_hash"
					and batch."first_ledger" = new."first_ledger"
			)
		then
			return new;
		end if;

		if new."next_ledger" > old."next_ledger"
			and new."first_ledger" = old."first_ledger"
			and new."first_batch_id" = old."first_batch_id"
			and exists (
				select 1 from "full_history_ingestion_batch" batch
				where batch.id = new."last_batch_id"
					and batch."network_passphrase_hash" =
						new."network_passphrase_hash"
					and batch."first_ledger" = old."next_ledger"
					and batch."last_ledger" + 1 = new."next_ledger"
			)
		then
			new."updated_at" = now();
			return new;
		end if;

		if new."next_ledger" = old."next_ledger"
			and new."last_batch_id" = old."last_batch_id"
			and new."first_ledger" < old."first_ledger"
			and exists (
				select 1 from "full_history_ingestion_batch" batch
				where batch.id = new."first_batch_id"
					and batch."network_passphrase_hash" =
						new."network_passphrase_hash"
					and batch."first_ledger" = new."first_ledger"
			)
		then
			select count(*)::integer, min(batch."first_ledger"),
				max(batch."last_ledger"),
				coalesce(sum(batch."ledger_count"), 0)
			into covered_batches, covered_first, covered_last, covered_ledgers
			from "full_history_ingestion_batch" batch
			where batch."network_passphrase_hash" =
					new."network_passphrase_hash"
				and batch."first_ledger" >= new."first_ledger"
				and batch."last_ledger" < old."first_ledger";
			if covered_batches between 1 and 8
				and covered_first = new."first_ledger"
				and covered_last = old."first_ledger" - 1
				and covered_ledgers = old."first_ledger" - new."first_ledger"
			then
				new."updated_at" = now();
				return new;
			end if;
		end if;

		raise exception 'full-history watermark must advance one contiguous frontier'
			using errcode = '23514';
	end
	$function$;
`;

const createForwardOnlyWatermarkFunctionSql = `
	create or replace function validate_full_history_watermark_advance()
	returns trigger
	language plpgsql
	as $function$
	begin
		if tg_op = 'DELETE' then
			raise exception 'full-history watermark deletion is prohibited'
				using errcode = '55000';
		end if;
		if tg_op = 'INSERT' then
			if not exists (
				select 1 from "full_history_ingestion_batch" batch
				where batch.id = new."last_batch_id"
					and batch."network_passphrase_hash" =
						new."network_passphrase_hash"
					and batch."last_ledger" + 1 = new."next_ledger"
			) then
				raise exception 'full-history watermark has no committed batch'
					using errcode = '23514';
			end if;
			return new;
		end if;
		if new."network_passphrase_hash" <> old."network_passphrase_hash"
			or new."next_ledger" <= old."next_ledger"
			or not exists (
				select 1 from "full_history_ingestion_batch" batch
				where batch.id = new."last_batch_id"
					and batch."network_passphrase_hash" =
						new."network_passphrase_hash"
					and batch."first_ledger" = old."next_ledger"
					and batch."last_ledger" + 1 = new."next_ledger"
			)
		then
			raise exception 'full-history watermark must advance contiguously'
				using errcode = '23514';
		end if;
		return new;
	end
	$function$;
`;

const dropHistoricalFrontierSql = `
	alter table "full_history_watermark"
		drop constraint "chk_full_history_watermark_first",
		drop constraint "fk_full_history_watermark_first_batch",
		drop constraint "uq_full_history_watermark_first_batch",
		drop column "first_batch_id",
		drop column "first_ledger";
`;

function assertActiveTransaction(queryRunner: QueryRunner): void {
	if (!queryRunner.isTransactionActive) {
		throw new Error(
			'Full-history historical backfill migration requires an active transaction'
		);
	}
}
