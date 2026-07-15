export const createFullHistoryLedgerCloseMetaCanonicalCoverageSql = `
	create table "full_history_lcm_state_canonical_coverage" (
		"batch_id" uuid not null,
		"network_passphrase_hash" bytea not null,
		"ledger_source_path" text not null,
		"ledger_source_sha256" bytea not null,
		"expected_ledger_count" integer not null,
		"matched_ledger_count" integer not null default 0,
		"status" varchar(16) not null default 'pending',
		"lease_owner" uuid,
		"lease_expires_at" timestamptz,
		"attempt_count" integer not null default 0,
		"created_at" timestamptz not null default now(),
		"updated_at" timestamptz not null default now(),
		"next_attempt_at" timestamptz not null default now(),
		"completed_at" timestamptz,
		"minimum_proof_version" smallint,
		"latest_proof_evaluated_at" timestamptz,
		"failure_kind" varchar(32),
		"error_text" text,
		constraint "pk_full_history_lcm_state_canonical_coverage"
			primary key ("batch_id"),
		constraint "uq_full_history_lcm_state_coverage_identity"
			unique ("batch_id", "network_passphrase_hash"),
		constraint "fk_full_history_lcm_state_coverage_batch" foreign key (
			"batch_id", "network_passphrase_hash"
		) references "full_history_ledger_close_meta_batch" (
			"id", "network_passphrase_hash"
		) on delete restrict,
		constraint "chk_full_history_lcm_state_coverage_source" check (
			octet_length("network_passphrase_hash") = 32
			and octet_length("ledger_source_sha256") = 32
			and length(btrim("ledger_source_path")) between 1 and 2048
			and "ledger_source_path" !~ '(^|/)\\.\\.?(/|$)'
		),
		constraint "chk_full_history_lcm_state_coverage_counts" check (
			"expected_ledger_count" between 64 and 1024
			and "matched_ledger_count" between 0 and "expected_ledger_count"
			and "attempt_count" >= 0
		),
		constraint "chk_full_history_lcm_state_coverage_status" check (
			"status" in ('pending', 'checking', 'complete', 'failed')
		),
		constraint "chk_full_history_lcm_state_coverage_lifecycle" check (
			("status" = 'pending'
				and "lease_owner" is null and "lease_expires_at" is null
				and "completed_at" is null
				and "minimum_proof_version" is null
				and "latest_proof_evaluated_at" is null
				and "failure_kind" is null)
			or ("status" = 'checking'
				and "lease_owner" is not null and "lease_expires_at" is not null
				and "completed_at" is null and "error_text" is null
				and "failure_kind" is null)
			or ("status" = 'complete'
				and "lease_owner" is null and "lease_expires_at" is null
				and "completed_at" is not null and "error_text" is null
				and "failure_kind" is null
				and "matched_ledger_count" = "expected_ledger_count"
				and "minimum_proof_version" >= 6
				and "latest_proof_evaluated_at" is not null)
			or ("status" = 'failed'
				and "lease_owner" is null and "lease_expires_at" is null
				and "completed_at" is null
				and "minimum_proof_version" is null
				and "latest_proof_evaluated_at" is null
				and length(btrim("failure_kind")) between 1 and 32
				and length(btrim("error_text")) between 1 and 65535)
		),
		constraint "chk_full_history_lcm_state_coverage_timestamps" check (
			"updated_at" >= "created_at"
			and "next_attempt_at" >= "created_at"
			and ("completed_at" is null or "completed_at" >= "created_at")
		)
	);

	create index "idx_full_history_lcm_state_coverage_claim"
		on "full_history_lcm_state_canonical_coverage" (
			"status", "next_attempt_at", "lease_expires_at", "created_at", "batch_id"
		) where "status" in ('pending', 'checking');

	create table "full_history_lcm_ledger_projection" (
		"batch_id" uuid not null,
		"ledger_sequence" bigint not null,
		"ledger_hash" bytea not null,
		"previous_ledger_hash" bytea not null,
		"transaction_set_hash" bytea not null,
		"transaction_result_hash" bytea not null,
		"bucket_list_hash" bytea not null,
		"protocol_version" integer not null,
		"closed_at" timestamptz not null,
		"transaction_count" integer not null,
		constraint "pk_full_history_lcm_ledger_projection"
			primary key ("batch_id", "ledger_sequence"),
		constraint "fk_full_history_lcm_ledger_projection_batch" foreign key (
			"batch_id"
		) references "full_history_ledger_close_meta_batch" ("id")
			on delete restrict,
		constraint "chk_full_history_lcm_ledger_projection_hashes" check (
			octet_length("ledger_hash") = 32
			and octet_length("previous_ledger_hash") = 32
			and octet_length("transaction_set_hash") = 32
			and octet_length("transaction_result_hash") = 32
			and octet_length("bucket_list_hash") = 32
		),
		constraint "chk_full_history_lcm_ledger_projection_values" check (
			"ledger_sequence" between 1 and 4294967295
			and "protocol_version" > 0
			and "transaction_count" >= 0
		)
	);

	create table "full_history_lcm_state_canonical_batch_link" (
		"lcm_batch_id" uuid not null,
		"canonical_batch_id" uuid not null,
		"network_passphrase_hash" bytea not null,
		constraint "pk_full_history_lcm_state_canonical_batch_link"
			primary key ("lcm_batch_id", "canonical_batch_id"),
		constraint "fk_full_history_lcm_state_link_coverage" foreign key (
			"lcm_batch_id", "network_passphrase_hash"
		) references "full_history_lcm_state_canonical_coverage" (
			"batch_id", "network_passphrase_hash"
		) on delete restrict,
		constraint "fk_full_history_lcm_state_link_canonical" foreign key (
			"canonical_batch_id", "network_passphrase_hash"
		) references "full_history_ingestion_batch" (
			"id", "network_passphrase_hash"
		) on delete restrict,
		constraint "chk_full_history_lcm_state_link_hash" check (
			octet_length("network_passphrase_hash") = 32
		)
	);

	create function validate_full_history_lcm_coverage_identity()
	returns trigger language plpgsql as $$
	declare
		batch_count integer;
		dataset_path text;
		dataset_sha bytea;
	begin
		select batch."ledger_count", dataset."storage_key", dataset."output_sha256"
		into strict batch_count, dataset_path, dataset_sha
		from "full_history_ledger_close_meta_batch" batch
		join "full_history_ledger_close_meta_dataset" dataset
			on dataset."batch_id" = batch."id" and dataset."dataset" = 'ledgers'
		where batch."id" = new."batch_id"
			and batch."network_passphrase_hash" = new."network_passphrase_hash";
		if new."expected_ledger_count" <> batch_count
			or new."ledger_source_path" <> dataset_path
			or new."ledger_source_sha256" <> dataset_sha then
			raise exception 'full-history LCM canonical coverage identity differs from its manifest';
		end if;
		return new;
	end
	$$;

	create trigger "trg_validate_full_history_lcm_coverage_identity"
	before insert or update on "full_history_lcm_state_canonical_coverage"
	for each row execute function validate_full_history_lcm_coverage_identity();

	create function validate_full_history_lcm_ledger_projection_range()
	returns trigger language plpgsql as $$
	begin
		if not exists (
			select 1 from "full_history_ledger_close_meta_batch" batch
			where batch."id" = new."batch_id"
				and new."ledger_sequence" between batch."start_ledger" and batch."end_ledger"
		) then
			raise exception 'full-history LCM ledger projection is outside its batch';
		end if;
		return new;
	end
	$$;

	create trigger "trg_validate_full_history_lcm_ledger_projection_range"
	before insert on "full_history_lcm_ledger_projection"
	for each row execute function validate_full_history_lcm_ledger_projection_range();

	create function validate_full_history_lcm_canonical_evidence_insert()
	returns trigger language plpgsql as $$
		declare
			coverage_id uuid;
		begin
			coverage_id := coalesce(
				(to_jsonb(new)->>'batch_id')::uuid,
				(to_jsonb(new)->>'lcm_batch_id')::uuid
			);
		if coverage_id is null or not exists (
			select 1 from "full_history_lcm_state_canonical_coverage" coverage
			where coverage."batch_id" = coverage_id
				and coverage."status" = 'checking'
				and coverage."lease_expires_at" > clock_timestamp()
		) then
			raise exception 'canonical coverage evidence requires an active lease'
				using errcode = '55000';
		end if;
		return new;
	end
	$$;

	create trigger "trg_validate_full_history_lcm_ledger_projection_insert"
	before insert on "full_history_lcm_ledger_projection"
	for each row execute function validate_full_history_lcm_canonical_evidence_insert();
	create trigger "trg_validate_full_history_lcm_state_link_insert"
	before insert on "full_history_lcm_state_canonical_batch_link"
	for each row execute function validate_full_history_lcm_canonical_evidence_insert();

	create function guard_full_history_lcm_canonical_coverage()
	returns trigger language plpgsql as $$
	declare
		projection_count integer;
		matching_count integer;
		minimum_version smallint;
		latest_evaluation timestamptz;
		state_import_count integer;
		account_expected bigint;
		trustline_expected bigint;
		account_count bigint;
		trustline_count bigint;
	begin
		if tg_op = 'DELETE' then
			raise exception 'full-history LCM canonical coverage cannot be deleted';
		end if;
		if tg_op = 'UPDATE' and old."status" in ('complete', 'failed') then
			raise exception 'terminal full-history LCM canonical coverage is immutable';
		end if;
		if new."status" <> 'complete' then
			return new;
		end if;

		select count(*),
			max("expected_record_count") filter (
				where control."dataset" = 'account-state-changes'
			),
			max("expected_record_count") filter (
				where control."dataset" = 'trustline-state-changes'
			)
		into state_import_count, account_expected, trustline_expected
		from "full_history_lcm_state_import" control
		join "full_history_ledger_close_meta_dataset" dataset
			on dataset."batch_id" = control."batch_id"
			and dataset."dataset" = control."dataset"
			and dataset."storage_key" = control."source_path"
			and dataset."output_sha256" = control."source_sha256"
			and dataset."record_count" = control."expected_record_count"
		where control."batch_id" = new."batch_id"
			and control."status" = 'complete'
			and control."imported_record_count" = control."expected_record_count"
			and octet_length(control."imported_row_set_sha256") = 32;
		if state_import_count <> 2 then
			raise exception 'both exact typed state row sets are required before canonical coverage';
		end if;
		select count(*) into account_count
		from "full_history_lcm_account_state_change"
		where "batch_id" = new."batch_id";
		select count(*) into trustline_count
		from "full_history_lcm_trustline_state_change"
		where "batch_id" = new."batch_id";
		if account_count <> account_expected
			or trustline_count <> trustline_expected then
			raise exception 'typed state row counts changed after import completion';
		end if;

		select count(*), count(*) filter (where
			canonical."ledger_sequence" is not null
			and proof."proof_version" >= 6
			and projection."ledger_hash" = canonical."ledger_hash"
			and projection."previous_ledger_hash" = canonical."previous_ledger_hash"
			and projection."transaction_set_hash" = canonical."transaction_set_hash"
			and projection."transaction_result_hash" = canonical."transaction_result_hash"
			and projection."bucket_list_hash" = canonical."bucket_list_hash"
			and projection."protocol_version" = canonical."protocol_version"
			and projection."closed_at" = canonical."closed_at"
			and projection."transaction_count" = canonical."transaction_count"
		), min(proof."proof_version"), max(proof."proof_evaluated_at")
		into projection_count, matching_count, minimum_version, latest_evaluation
		from "full_history_lcm_ledger_projection" projection
		left join "full_history_ledger" canonical
			on canonical."network_passphrase_hash" = new."network_passphrase_hash"
			and canonical."ledger_sequence" = projection."ledger_sequence"
		left join "full_history_ingestion_batch" proof
			on proof."id" = canonical."batch_id"
			and proof."network_passphrase_hash" = canonical."network_passphrase_hash"
		where projection."batch_id" = new."batch_id";

		if projection_count <> new."expected_ledger_count"
			or matching_count <> new."expected_ledger_count"
			or new."matched_ledger_count" <> matching_count
			or new."minimum_proof_version" <> minimum_version
			or new."latest_proof_evaluated_at" <> latest_evaluation then
			raise exception 'LCM ledger projection does not match canonical archive proof evidence';
		end if;
		if exists (
			select canonical."batch_id"
			from "full_history_lcm_ledger_projection" projection
			join "full_history_ledger" canonical
				on canonical."network_passphrase_hash" = new."network_passphrase_hash"
				and canonical."ledger_sequence" = projection."ledger_sequence"
			where projection."batch_id" = new."batch_id"
			except
			select link."canonical_batch_id"
			from "full_history_lcm_state_canonical_batch_link" link
			where link."lcm_batch_id" = new."batch_id"
		) or exists (
			select link."canonical_batch_id"
			from "full_history_lcm_state_canonical_batch_link" link
			where link."lcm_batch_id" = new."batch_id"
			except
			select canonical."batch_id"
			from "full_history_lcm_ledger_projection" projection
			join "full_history_ledger" canonical
				on canonical."network_passphrase_hash" = new."network_passphrase_hash"
				and canonical."ledger_sequence" = projection."ledger_sequence"
			where projection."batch_id" = new."batch_id"
		) then
			raise exception 'LCM canonical proof batch links are incomplete';
		end if;
		return new;
	end
	$$;

	create trigger "trg_guard_full_history_lcm_canonical_coverage"
	before insert or update or delete
		on "full_history_lcm_state_canonical_coverage"
	for each row execute function guard_full_history_lcm_canonical_coverage();

	create function reject_full_history_lcm_canonical_evidence_mutation()
	returns trigger language plpgsql as $$
	begin
		raise exception 'full-history LCM canonical evidence is immutable';
	end
	$$;

	create trigger "trg_reject_full_history_lcm_ledger_projection_mutation"
	before update or delete on "full_history_lcm_ledger_projection"
	for each row execute function reject_full_history_lcm_canonical_evidence_mutation();

	create trigger "trg_reject_full_history_lcm_state_link_mutation"
	before update or delete on "full_history_lcm_state_canonical_batch_link"
	for each row execute function reject_full_history_lcm_canonical_evidence_mutation();

	create function reject_full_history_canonical_ledger_mutation()
	returns trigger language plpgsql as $$
	begin
		raise exception 'canonical full-history ledger evidence is immutable';
	end
	$$;

	create trigger "trg_reject_full_history_canonical_ledger_mutation"
	before update or delete on "full_history_ledger"
	for each row execute function reject_full_history_canonical_ledger_mutation();
`;

export const dropFullHistoryLedgerCloseMetaCanonicalCoverageSql = `
	drop trigger "trg_reject_full_history_canonical_ledger_mutation"
		on "full_history_ledger";
	drop function reject_full_history_canonical_ledger_mutation();
	drop table "full_history_lcm_state_canonical_batch_link";
	drop table "full_history_lcm_ledger_projection";
	drop table "full_history_lcm_state_canonical_coverage";
		drop function guard_full_history_lcm_canonical_coverage();
		drop function reject_full_history_lcm_canonical_evidence_mutation();
		drop function validate_full_history_lcm_canonical_evidence_insert();
		drop function validate_full_history_lcm_ledger_projection_range();
	drop function validate_full_history_lcm_coverage_identity();
`;
