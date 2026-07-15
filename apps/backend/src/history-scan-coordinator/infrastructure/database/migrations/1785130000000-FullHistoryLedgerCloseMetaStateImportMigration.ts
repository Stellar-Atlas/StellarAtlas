import type { MigrationInterface, QueryRunner } from 'typeorm';

const migrationTimeouts = `
	set local lock_timeout = '2s';
	set local statement_timeout = '30s'
`;

export class FullHistoryLedgerCloseMetaStateImportMigration1785130000000 implements MigrationInterface {
	readonly name = 'FullHistoryLedgerCloseMetaStateImportMigration1785130000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(createStateImportSchemaSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(dropStateImportSchemaSql);
	}
}

const createStateImportSchemaSql = `
	create table "full_history_lcm_state_import" (
		"batch_id" uuid not null,
		"dataset" varchar(32) not null,
		"source_path" text not null,
		"source_sha256" bytea not null,
		"expected_record_count" bigint not null,
		"imported_record_count" bigint not null default 0,
		"status" varchar(16) not null default 'pending',
		"lease_owner" uuid,
		"lease_expires_at" timestamptz,
		"attempt_count" integer not null default 0,
		"created_at" timestamptz not null default now(),
		"updated_at" timestamptz not null default now(),
		"next_attempt_at" timestamptz not null default now(),
		"completed_at" timestamptz,
		"error_text" text,
		constraint "pk_full_history_lcm_state_import" primary key (
			"batch_id", "dataset"
		),
		constraint "fk_full_history_lcm_state_import_batch" foreign key (
			"batch_id"
		) references "full_history_ledger_close_meta_batch" ("id")
			on delete restrict,
		constraint "chk_full_history_lcm_state_import_dataset" check (
			"dataset" in (
				'account-state-changes', 'trustline-state-changes'
			)
		),
		constraint "chk_full_history_lcm_state_import_source" check (
			length(btrim("source_path")) between 1 and 4096
			and octet_length("source_sha256") = 32
		),
		constraint "chk_full_history_lcm_state_import_counts" check (
			"expected_record_count" >= 0
			and "imported_record_count" between 0 and "expected_record_count"
			and "attempt_count" >= 0
		),
		constraint "chk_full_history_lcm_state_import_status" check (
			"status" in ('pending', 'importing', 'complete', 'failed')
		),
		constraint "chk_full_history_lcm_state_import_timestamps" check (
			"updated_at" >= "created_at"
			and "next_attempt_at" >= "created_at"
			and ("completed_at" is null or "completed_at" >= "created_at")
		),
		constraint "chk_full_history_lcm_state_import_lifecycle" check (
			("status" = 'pending'
				and "lease_owner" is null and "lease_expires_at" is null
				and "completed_at" is null and "error_text" is null)
			or ("status" = 'importing'
				and "lease_owner" is not null and "lease_expires_at" is not null
				and "completed_at" is null and "error_text" is null)
			or ("status" = 'complete'
				and "lease_owner" is null and "lease_expires_at" is null
				and "completed_at" is not null and "error_text" is null
				and "imported_record_count" = "expected_record_count")
			or ("status" = 'failed'
				and "lease_owner" is null and "lease_expires_at" is null
				and "completed_at" is null and "error_text" is not null
				and length(btrim("error_text")) between 1 and 65535)
		)
	);

	create index "idx_full_history_lcm_state_import_claim"
		on "full_history_lcm_state_import" (
			"status", "next_attempt_at", "lease_expires_at",
			"created_at", "batch_id", "dataset"
		) where "status" in ('pending', 'importing', 'failed');

	create table "full_history_lcm_account_state_change" (
		"batch_id" uuid not null,
		"ledger_sequence" bigint not null,
		"transaction_index" bigint not null,
		"change_index" bigint not null,
		"transaction_hash" bytea,
		"reason" varchar(32) not null,
		"operation_index" bigint,
		"upgrade_index" bigint,
		"change_type" integer not null,
		"change_type_string" varchar(64) not null,
		"deleted" boolean not null,
		"ledger_key_sha256" bytea not null,
		"state_entry_xdr" bytea not null,
		"last_modified_ledger" bigint not null,
		"sponsor" varchar(64),
		"closed_at_unix_millis" bigint not null,
		"account_id" varchar(64) not null,
		"balance" bigint not null,
		"buying_liabilities" bigint not null,
		"selling_liabilities" bigint not null,
		"sequence_number" bigint not null,
		"sequence_ledger" bigint,
		"sequence_time" bigint,
		"subentry_count" bigint not null,
		"flags" bigint not null,
		"home_domain" text not null,
		"inflation_destination" varchar(64),
		"master_weight" integer not null,
		"low_threshold" integer not null,
		"medium_threshold" integer not null,
		"high_threshold" integer not null,
		"sponsored_entry_count" bigint not null,
		"sponsoring_entry_count" bigint not null,
		"signer_count" bigint not null,
		"signer_keys" jsonb not null,
		"signer_weights" jsonb not null,
		"signer_sponsors" jsonb not null,
		constraint "pk_full_history_lcm_account_state_change" primary key (
			"batch_id", "ledger_sequence", "transaction_index", "change_index"
		),
		constraint "fk_full_history_lcm_account_state_change_batch" foreign key (
			"batch_id"
		) references "full_history_ledger_close_meta_batch" ("id")
			on delete restrict,
		constraint "chk_full_history_lcm_account_change_identity" check (
			"ledger_sequence" between 1 and 4294967295
			and "transaction_index" between 0 and 4294967295
			and "change_index" between 1 and 4294967295
			and ("operation_index" is null
				or "operation_index" between 1 and 4294967295)
			and ("upgrade_index" is null
				or "upgrade_index" between 1 and 4294967295)
			and "last_modified_ledger" between 0 and "ledger_sequence"
			and "closed_at_unix_millis" >= 0
		),
		constraint "chk_full_history_lcm_account_change_provenance" check (
			"reason" in ('fee', 'fee_refund', 'operation', 'transaction', 'upgrade')
			and "change_type" >= 0
			and length(btrim("change_type_string")) between 1 and 64
			and not ("operation_index" is not null
				and "upgrade_index" is not null)
			and ("operation_index" is null or "reason" = 'operation')
			and (("reason" = 'upgrade' and "transaction_hash" is null
					and "transaction_index" = 0 and "upgrade_index" is not null)
				or ("reason" <> 'upgrade' and "transaction_hash" is not null
					and "upgrade_index" is null))
		),
		constraint "chk_full_history_lcm_account_change_hashes" check (
			("transaction_hash" is null
				or octet_length("transaction_hash") = 32)
			and octet_length("ledger_key_sha256") = 32
			and octet_length("state_entry_xdr") > 0
		),
		constraint "chk_full_history_lcm_account_change_text" check (
			length(btrim("account_id")) between 1 and 64
			and octet_length("home_domain") <= 32
			and ("sponsor" is null
				or length(btrim("sponsor")) between 1 and 64)
			and ("inflation_destination" is null
				or length(btrim("inflation_destination")) between 1 and 64)
		),
		constraint "chk_full_history_lcm_account_change_numbers" check (
			"sequence_number" >= 0
			and "subentry_count" between 0 and 4294967295
			and "flags" between 0 and 4294967295
			and "sponsored_entry_count" between 0 and 4294967295
			and "sponsoring_entry_count" between 0 and 4294967295
			and "signer_count" between 0 and 4294967295
			and "buying_liabilities" >= 0 and "selling_liabilities" >= 0
			and "master_weight" between 0 and 255
			and "low_threshold" between 0 and 255
			and "medium_threshold" between 0 and 255
			and "high_threshold" between 0 and 255
		),
		constraint "chk_full_history_lcm_account_change_sequence" check (
			("sequence_ledger" is null and "sequence_time" is null)
			or ("sequence_ledger" between 0 and 4294967295
				and "sequence_time" >= 0)
		),
		constraint "chk_full_history_lcm_account_change_signers" check (
			jsonb_typeof("signer_keys") = 'array'
			and jsonb_typeof("signer_weights") = 'array'
			and jsonb_typeof("signer_sponsors") = 'array'
			and jsonb_array_length("signer_keys") = "signer_count"
			and jsonb_array_length("signer_weights") = "signer_count"
			and jsonb_array_length("signer_sponsors") = "signer_count"
		)
	);

	create table "full_history_lcm_trustline_state_change" (
		"batch_id" uuid not null,
		"ledger_sequence" bigint not null,
		"transaction_index" bigint not null,
		"change_index" bigint not null,
		"transaction_hash" bytea,
		"reason" varchar(32) not null,
		"operation_index" bigint,
		"upgrade_index" bigint,
		"change_type" integer not null,
		"change_type_string" varchar(64) not null,
		"deleted" boolean not null,
		"ledger_key_sha256" bytea not null,
		"state_entry_xdr" bytea not null,
		"last_modified_ledger" bigint not null,
		"sponsor" varchar(64),
		"closed_at_unix_millis" bigint not null,
		"account_id" varchar(64) not null,
		"asset_type" integer not null,
		"asset_type_string" varchar(64) not null,
		"asset_code" varchar(12),
		"asset_issuer" varchar(64),
		"liquidity_pool_id" bytea,
		"balance" bigint not null,
		"limit" bigint not null,
		"buying_liabilities" bigint not null,
		"selling_liabilities" bigint not null,
		"liquidity_pool_use_count" integer not null,
		"flags" bigint not null,
		constraint "pk_full_history_lcm_trustline_state_change" primary key (
			"batch_id", "ledger_sequence", "transaction_index", "change_index"
		),
		constraint "fk_full_history_lcm_trustline_state_change_batch" foreign key (
			"batch_id"
		) references "full_history_ledger_close_meta_batch" ("id")
			on delete restrict,
		constraint "chk_full_history_lcm_trustline_change_identity" check (
			"ledger_sequence" between 1 and 4294967295
			and "transaction_index" between 0 and 4294967295
			and "change_index" between 1 and 4294967295
			and ("operation_index" is null
				or "operation_index" between 1 and 4294967295)
			and ("upgrade_index" is null
				or "upgrade_index" between 1 and 4294967295)
			and "last_modified_ledger" between 0 and "ledger_sequence"
			and "closed_at_unix_millis" >= 0
		),
		constraint "chk_full_history_lcm_trustline_change_provenance" check (
			"reason" in ('fee', 'fee_refund', 'operation', 'transaction', 'upgrade')
			and "change_type" >= 0
			and length(btrim("change_type_string")) between 1 and 64
			and not ("operation_index" is not null
				and "upgrade_index" is not null)
			and ("operation_index" is null or "reason" = 'operation')
			and (("reason" = 'upgrade' and "transaction_hash" is null
					and "transaction_index" = 0 and "upgrade_index" is not null)
				or ("reason" <> 'upgrade' and "transaction_hash" is not null
					and "upgrade_index" is null))
		),
		constraint "chk_full_history_lcm_trustline_change_hashes" check (
			("transaction_hash" is null
				or octet_length("transaction_hash") = 32)
			and octet_length("ledger_key_sha256") = 32
			and octet_length("state_entry_xdr") > 0
		),
		constraint "chk_full_history_lcm_trustline_change_text" check (
			length(btrim("account_id")) between 1 and 64
			and length(btrim("asset_type_string")) between 1 and 64
			and ("sponsor" is null
				or length(btrim("sponsor")) between 1 and 64)
		),
		constraint "chk_full_history_lcm_trustline_change_asset" check (
			("asset_type" = 1 and "asset_code" is not null
				and octet_length("asset_code") between 1 and 4
				and "asset_issuer" is not null and "liquidity_pool_id" is null)
			or ("asset_type" = 2 and "asset_code" is not null
				and octet_length("asset_code") between 1 and 12
				and "asset_issuer" is not null and "liquidity_pool_id" is null)
			or ("asset_type" = 3 and "asset_code" is null
				and "asset_issuer" is null
				and "liquidity_pool_id" is not null
				and octet_length("liquidity_pool_id") = 32)
		),
		constraint "chk_full_history_lcm_trustline_change_numbers" check (
			"limit" >= 0
			and "buying_liabilities" >= 0 and "selling_liabilities" >= 0
			and "liquidity_pool_use_count" >= 0
			and "flags" between 0 and 4294967295
		)
	);

	create function validate_full_history_lcm_state_change_batch_range()
	returns trigger language plpgsql as $$
	declare
		batch_start bigint;
		batch_end bigint;
	begin
		select "start_ledger", "end_ledger" into batch_start, batch_end
		from "full_history_ledger_close_meta_batch"
		where "id" = new."batch_id";
		if found and new."ledger_sequence" not between batch_start and batch_end then
			raise exception 'full-history LCM state change ledger is outside its batch range'
				using errcode = '23514';
		end if;
		return new;
	end
	$$;

	create trigger "trg_validate_full_history_lcm_account_change_range"
	before insert on "full_history_lcm_account_state_change"
	for each row execute function validate_full_history_lcm_state_change_batch_range();

	create trigger "trg_validate_full_history_lcm_trustline_change_range"
	before insert on "full_history_lcm_trustline_state_change"
	for each row execute function validate_full_history_lcm_state_change_batch_range();

	create function reject_full_history_lcm_completed_import_mutation()
	returns trigger language plpgsql as $$
	begin
		if old."status" = 'complete' then
			raise exception 'completed full-history LCM state import is immutable'
				using errcode = '55000';
		end if;
		if tg_op = 'DELETE' then
			return old;
		end if;
		return new;
	end
	$$;

	create trigger "trg_reject_full_history_lcm_completed_import_mutation"
	before update or delete on "full_history_lcm_state_import"
	for each row execute function reject_full_history_lcm_completed_import_mutation();

	create function reject_full_history_lcm_state_evidence_mutation()
	returns trigger language plpgsql as $$
	begin
		raise exception 'full-history LCM state evidence is immutable'
			using errcode = '55000';
	end
	$$;

	create trigger "trg_reject_full_history_lcm_account_change_mutation"
	before update or delete on "full_history_lcm_account_state_change"
	for each row execute function reject_full_history_lcm_state_evidence_mutation();

	create trigger "trg_reject_full_history_lcm_trustline_change_mutation"
	before update or delete on "full_history_lcm_trustline_state_change"
	for each row execute function reject_full_history_lcm_state_evidence_mutation()
`;

const dropStateImportSchemaSql = `
	do $$
	begin
		if exists (select 1 from "full_history_lcm_state_import")
			or exists (select 1 from "full_history_lcm_account_state_change")
			or exists (select 1 from "full_history_lcm_trustline_state_change") then
			raise exception 'cannot downgrade full-history LCM state import with durable rows'
				using errcode = '55000';
		end if;
	end
	$$;

	drop table "full_history_lcm_trustline_state_change";
	drop table "full_history_lcm_account_state_change";
	drop table "full_history_lcm_state_import";
	drop function reject_full_history_lcm_state_evidence_mutation();
	drop function reject_full_history_lcm_completed_import_mutation();
	drop function validate_full_history_lcm_state_change_batch_range()
`;

function assertActiveTransaction(queryRunner: QueryRunner): void {
	if (!queryRunner.isTransactionActive) {
		throw new Error(
			'Full-history LedgerCloseMeta state import migration requires an active transaction'
		);
	}
}
