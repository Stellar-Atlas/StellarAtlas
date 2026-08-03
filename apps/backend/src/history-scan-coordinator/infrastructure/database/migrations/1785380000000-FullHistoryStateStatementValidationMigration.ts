import type { MigrationInterface, QueryRunner } from 'typeorm';

const applyStatementValidationSql = `
	begin;
	set local lock_timeout = '10s';

	drop trigger "trg_validate_full_history_lcm_account_change_import"
		on "full_history_lcm_account_state_change";
	drop trigger "trg_validate_full_history_lcm_account_change_range"
		on "full_history_lcm_account_state_change";
	drop trigger "trg_validate_full_history_lcm_trustline_change_import"
		on "full_history_lcm_trustline_state_change";
	drop trigger "trg_validate_full_history_lcm_trustline_change_range"
		on "full_history_lcm_trustline_state_change";

	create function validate_full_history_lcm_state_change_statement()
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
		if expected_dataset is null or exists (
			select 1
			from (select distinct "batch_id" from inserted) incoming
			left join "full_history_lcm_state_import" control
				on control."batch_id" = incoming."batch_id"
				and control."dataset" = expected_dataset
			where control."batch_id" is null
				or control."status" <> 'importing'
				or control."lease_expires_at" <= clock_timestamp()
		) then
			raise exception 'state evidence requires an active import lease'
				using errcode = '55000';
		end if;
		if exists (
			select 1
			from inserted incoming
			left join "full_history_ledger_close_meta_batch" batch
				on batch."id" = incoming."batch_id"
			where batch."id" is null
				or incoming."ledger_sequence" not between
					batch."start_ledger" and batch."end_ledger"
		) then
			raise exception 'full-history LCM state change ledger is outside its batch range'
				using errcode = '23514';
		end if;
		return null;
	end
	$$;

	create trigger "trg_validate_full_history_lcm_account_change_statement"
	after insert on "full_history_lcm_account_state_change"
	referencing new table as inserted
	for each statement execute function
		validate_full_history_lcm_state_change_statement();
	create trigger "trg_validate_full_history_lcm_trustline_change_statement"
	after insert on "full_history_lcm_trustline_state_change"
	referencing new table as inserted
	for each statement execute function
		validate_full_history_lcm_state_change_statement();

	commit
`;

const restoreRowValidationSql = `
	begin;
	set local lock_timeout = '10s';

	drop trigger "trg_validate_full_history_lcm_account_change_statement"
		on "full_history_lcm_account_state_change";
	drop trigger "trg_validate_full_history_lcm_trustline_change_statement"
		on "full_history_lcm_trustline_state_change";
	drop function validate_full_history_lcm_state_change_statement();

	create trigger "trg_validate_full_history_lcm_account_change_range"
	before insert on "full_history_lcm_account_state_change"
	for each row execute function
		validate_full_history_lcm_state_change_batch_range();
	create trigger "trg_validate_full_history_lcm_trustline_change_range"
	before insert on "full_history_lcm_trustline_state_change"
	for each row execute function
		validate_full_history_lcm_state_change_batch_range();
	create trigger "trg_validate_full_history_lcm_account_change_import"
	before insert on "full_history_lcm_account_state_change"
	for each row execute function
		validate_full_history_lcm_state_evidence_insert();
	create trigger "trg_validate_full_history_lcm_trustline_change_import"
	before insert on "full_history_lcm_trustline_state_change"
	for each row execute function
		validate_full_history_lcm_state_evidence_insert();

	commit
`;

export class FullHistoryStateStatementValidationMigration1785380000000 implements MigrationInterface {
	readonly name = 'FullHistoryStateStatementValidationMigration1785380000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(applyStatementValidationSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(restoreRowValidationSql);
	}
}
