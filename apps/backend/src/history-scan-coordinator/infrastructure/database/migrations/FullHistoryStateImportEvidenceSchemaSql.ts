export const hardenFullHistoryStateImportEvidenceSql = `
	lock table "full_history_lcm_state_import",
		"full_history_lcm_account_state_change",
		"full_history_lcm_trustline_state_change",
		"full_history_ledger" in share row exclusive mode;

	do $$
	begin
		if exists (
			select 1 from "full_history_lcm_state_import"
			where "status" = 'complete'
				and ("expected_record_count" <> 0 or "imported_record_count" <> 0)
		) or exists (select 1 from "full_history_lcm_account_state_change")
			or exists (select 1 from "full_history_lcm_trustline_state_change") then
			raise exception 'existing state imports require explicit row-evidence reconciliation'
				using errcode = '55000';
		end if;
		if exists (
			select 1
			from "full_history_lcm_state_import" control
			left join "full_history_ledger_close_meta_dataset" dataset
				on dataset."batch_id" = control."batch_id"
				and dataset."dataset" = control."dataset"
			where dataset."batch_id" is null
				or control."source_path" <> dataset."storage_key"
				or control."source_sha256" <> dataset."output_sha256"
				or control."expected_record_count" <> dataset."record_count"
		) then
			raise exception 'state import control differs from its immutable dataset manifest'
				using errcode = '23503';
		end if;
	end
	$$;

	alter table "full_history_lcm_state_import"
		add column "imported_row_set_sha256" bytea,
		add constraint "fk_full_history_lcm_state_import_dataset" foreign key (
			"batch_id", "dataset"
		) references "full_history_ledger_close_meta_dataset" (
			"batch_id", "dataset"
		) on delete restrict;
	alter table "full_history_lcm_account_state_change"
		add column "row_sha256" bytea not null;
	alter table "full_history_lcm_trustline_state_change"
		add column "row_sha256" bytea not null;
	drop trigger "trg_reject_full_history_lcm_completed_import_mutation"
		on "full_history_lcm_state_import";
	update "full_history_lcm_state_import"
	set "imported_row_set_sha256" = decode(
		'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		'hex'
	)
	where "status" = 'complete' and "expected_record_count" = 0
		and "imported_record_count" = 0;
	create trigger "trg_reject_full_history_lcm_completed_import_mutation"
	before update or delete on "full_history_lcm_state_import"
	for each row execute function reject_full_history_lcm_completed_import_mutation();

	alter table "full_history_lcm_state_import"
		drop constraint "chk_full_history_lcm_state_import_lifecycle";
	alter table "full_history_lcm_state_import"
		add constraint "chk_full_history_lcm_state_import_row_set" check (
			("status" = 'complete'
				and octet_length("imported_row_set_sha256") = 32)
			or ("status" <> 'complete' and "imported_row_set_sha256" is null)
		),
		add constraint "chk_full_history_lcm_state_import_lifecycle" check (
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
		);
	alter table "full_history_lcm_account_state_change"
		add constraint "chk_full_history_lcm_account_change_row_sha256"
			check (octet_length("row_sha256") = 32);
	alter table "full_history_lcm_trustline_state_change"
		add constraint "chk_full_history_lcm_trustline_change_row_sha256"
			check (octet_length("row_sha256") = 32);

	create function validate_full_history_lcm_state_import_identity()
	returns trigger language plpgsql as $$
	declare
		manifest_path text;
		manifest_sha bytea;
		manifest_count bigint;
	begin
		select dataset."storage_key", dataset."output_sha256", dataset."record_count"
		into strict manifest_path, manifest_sha, manifest_count
		from "full_history_ledger_close_meta_dataset" dataset
		where dataset."batch_id" = new."batch_id"
			and dataset."dataset" = new."dataset";
		if new."source_path" <> manifest_path
			or new."source_sha256" <> manifest_sha
			or new."expected_record_count" <> manifest_count then
			raise exception 'state import identity differs from its immutable dataset manifest'
				using errcode = '23514';
		end if;
		return new;
	end
	$$;

	create trigger "trg_validate_full_history_lcm_state_import_identity"
	before insert or update on "full_history_lcm_state_import"
	for each row execute function validate_full_history_lcm_state_import_identity();

	create function validate_full_history_lcm_state_evidence_insert()
	returns trigger language plpgsql as $$
	declare
		expected_dataset text;
	begin
		expected_dataset := case tg_table_name
			when 'full_history_lcm_account_state_change'
				then 'account-state-changes'
			when 'full_history_lcm_trustline_state_change'
				then 'trustline-state-changes'
			else null
		end;
		if expected_dataset is null or not exists (
			select 1 from "full_history_lcm_state_import" control
			where control."batch_id" = new."batch_id"
				and control."dataset" = expected_dataset
				and control."status" = 'importing'
				and control."lease_expires_at" > clock_timestamp()
		) then
			raise exception 'state evidence requires an active import lease'
				using errcode = '55000';
		end if;
		return new;
	end
	$$;

	create trigger "trg_validate_full_history_lcm_account_change_import"
	before insert on "full_history_lcm_account_state_change"
	for each row execute function validate_full_history_lcm_state_evidence_insert();
	create trigger "trg_validate_full_history_lcm_trustline_change_import"
	before insert on "full_history_lcm_trustline_state_change"
	for each row execute function validate_full_history_lcm_state_evidence_insert();

	do $$
	begin
		if exists (
			select 1
			from "full_history_ledger" ledger
			join "full_history_ingestion_batch" batch
				on batch."id" = ledger."batch_id"
				and batch."network_passphrase_hash" = ledger."network_passphrase_hash"
			where ledger."ledger_sequence" not between
				batch."first_ledger" and batch."last_ledger"
		) then
			raise exception 'canonical ledgers exist outside their provenance batch'
				using errcode = '23514';
		end if;
	end
	$$;

	create function validate_full_history_canonical_ledger_batch_range()
	returns trigger language plpgsql as $$
	begin
		if not exists (
			select 1 from "full_history_ingestion_batch" batch
			where batch."id" = new."batch_id"
				and batch."network_passphrase_hash" = new."network_passphrase_hash"
				and new."ledger_sequence" between
					batch."first_ledger" and batch."last_ledger"
		) then
			raise exception 'canonical ledger is outside its provenance batch'
				using errcode = '23514';
		end if;
		return new;
	end
	$$;

	create trigger "trg_validate_full_history_canonical_ledger_batch_range"
	before insert on "full_history_ledger"
	for each row execute function validate_full_history_canonical_ledger_batch_range();
`;

export const dropFullHistoryStateImportEvidenceHardeningSql = `
	drop trigger "trg_validate_full_history_canonical_ledger_batch_range"
		on "full_history_ledger";
	drop function validate_full_history_canonical_ledger_batch_range();
	drop trigger "trg_validate_full_history_lcm_trustline_change_import"
		on "full_history_lcm_trustline_state_change";
	drop trigger "trg_validate_full_history_lcm_account_change_import"
		on "full_history_lcm_account_state_change";
	drop function validate_full_history_lcm_state_evidence_insert();
	drop trigger "trg_validate_full_history_lcm_state_import_identity"
		on "full_history_lcm_state_import";
	drop function validate_full_history_lcm_state_import_identity();
	alter table "full_history_lcm_trustline_state_change"
		drop constraint "chk_full_history_lcm_trustline_change_row_sha256",
		drop column "row_sha256";
	alter table "full_history_lcm_account_state_change"
		drop constraint "chk_full_history_lcm_account_change_row_sha256",
		drop column "row_sha256";
	alter table "full_history_lcm_state_import"
		drop constraint "fk_full_history_lcm_state_import_dataset",
		drop constraint "chk_full_history_lcm_state_import_row_set",
		drop constraint "chk_full_history_lcm_state_import_lifecycle",
		drop column "imported_row_set_sha256",
		add constraint "chk_full_history_lcm_state_import_lifecycle" check (
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
		);
`;
