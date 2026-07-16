import { fullHistoryStrictCanonicalBatchProofPredicateSql } from './FullHistoryStrictCanonicalProofSql.js';

export const createFullHistoryCanonicalCoverageGuardFunctionSql = `
	create or replace function guard_full_history_lcm_canonical_coverage()
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
			and attestation.valid
			and projection."ledger_hash" = canonical."ledger_hash"
			and projection."previous_ledger_hash" = canonical."previous_ledger_hash"
			and projection."transaction_set_hash" = canonical."transaction_set_hash"
			and projection."transaction_result_hash" = canonical."transaction_result_hash"
			and projection."bucket_list_hash" = canonical."bucket_list_hash"
			and projection."protocol_version" = canonical."protocol_version"
			and projection."closed_at" = canonical."closed_at"
			and projection."transaction_count" = canonical."transaction_count"
		), min(current_proof."proofVersion") filter (where attestation.valid),
			max(current_proof."evaluatedAt") filter (where attestation.valid)
		into projection_count, matching_count, minimum_version, latest_evaluation
		from "full_history_lcm_ledger_projection" projection
		left join "full_history_ledger" canonical
			on canonical."network_passphrase_hash" = new."network_passphrase_hash"
			and canonical."ledger_sequence" = projection."ledger_sequence"
		left join "full_history_ingestion_batch" batch
			on batch."id" = canonical."batch_id"
			and batch."network_passphrase_hash" = canonical."network_passphrase_hash"
		left join "history_archive_checkpoint_proof" current_proof
			on current_proof.id = batch."checkpoint_proof_id"
		left join lateral (
			select (${fullHistoryStrictCanonicalBatchProofPredicateSql}) as valid
		) attestation on true
		where projection."batch_id" = new."batch_id";

		if projection_count <> new."expected_ledger_count"
			or matching_count <> new."expected_ledger_count"
			or new."matched_ledger_count" <> matching_count
			or new."minimum_proof_version" <> minimum_version
			or new."latest_proof_evaluated_at" <> latest_evaluation then
			raise exception 'LCM ledger projection does not match current strict canonical archive proof evidence';
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
	$$
`;
