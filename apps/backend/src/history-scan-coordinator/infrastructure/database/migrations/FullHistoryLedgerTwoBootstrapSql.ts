export const allowFullHistoryLedgerTwoBootstrapSql = `
	alter table "full_history_ledger_close_meta_batch"
		drop constraint "chk_full_history_lcm_batch_range";
	alter table "full_history_ledger_close_meta_batch"
		add constraint "chk_full_history_lcm_batch_range" check (
			"start_ledger" between 1 and 4294967295
			and "end_ledger" between "start_ledger" and 4294967295
			and "ledger_count" = "end_ledger" - "start_ledger" + 1
			and (
				"ledger_count" between 64 and 1024
				or (
					"start_ledger" = 2
					and "end_ledger" = 2
					and "ledger_count" = 1
				)
			)
		);

	create or replace function validate_full_history_lcm_watermark_advance()
	returns trigger language plpgsql as $$
	declare
		batch_record "full_history_ledger_close_meta_batch"%rowtype;
		previous_batch "full_history_ledger_close_meta_batch"%rowtype;
		ledger_two "full_history_ledger_close_meta_batch"%rowtype;
		ledger_three_batch "full_history_ledger_close_meta_batch"%rowtype;
	begin
		if tg_op = 'DELETE' then
			raise exception 'full-history LedgerCloseMeta watermark deletion is prohibited';
		end if;
		if tg_op = 'INSERT' then
			if new."last_batch_id" is not null
				or new."next_ledger" <> new."first_available_ledger"
				or new."version" <> 0 then
				raise exception 'full-history LedgerCloseMeta watermark must start at its first available ledger';
			end if;
			return new;
		end if;
		if new."network_passphrase_hash" = old."network_passphrase_hash"
			and old."first_available_ledger" = 3
			and new."first_available_ledger" = 2
			and old."last_batch_id" is not null
			and new."last_batch_id" is not distinct from old."last_batch_id"
			and new."next_ledger" = old."next_ledger"
			and new."version" = old."version" + 1 then
			select * into strict ledger_two
			from "full_history_ledger_close_meta_batch"
			where "network_passphrase_hash" = new."network_passphrase_hash"
				and "start_ledger" = 2 and "end_ledger" = 2
			for key share;
			select * into strict ledger_three_batch
			from "full_history_ledger_close_meta_batch"
			where "network_passphrase_hash" = new."network_passphrase_hash"
				and "start_ledger" = 3
			for key share;
			if ledger_two."last_ledger_hash" <>
					ledger_three_batch."first_previous_ledger_hash" then
				raise exception 'full-history ledger two does not link to the ledger-three batch';
			end if;
			perform assert_full_history_lcm_batch_dataset_set(ledger_two."id");
			return new;
		end if;
		if new."network_passphrase_hash" <> old."network_passphrase_hash"
			or new."first_available_ledger" <> old."first_available_ledger" then
			raise exception 'full-history LedgerCloseMeta watermark identity is immutable';
		end if;
		if new."version" <> old."version" + 1 then
			raise exception 'full-history LedgerCloseMeta watermark version must advance once';
		end if;
		select * into strict batch_record
		from "full_history_ledger_close_meta_batch"
		where "id" = new."last_batch_id" for key share;
		if batch_record."network_passphrase_hash" <>
				new."network_passphrase_hash"
			or batch_record."start_ledger" <> old."next_ledger"
			or batch_record."end_ledger" + 1 <> new."next_ledger" then
			raise exception 'full-history LedgerCloseMeta watermark must advance one contiguous batch';
		end if;
		if old."last_batch_id" is not null then
			select * into strict previous_batch
			from "full_history_ledger_close_meta_batch"
			where "id" = old."last_batch_id" for key share;
			if previous_batch."last_ledger_hash" <>
					batch_record."first_previous_ledger_hash" then
				raise exception 'full-history LedgerCloseMeta watermark chain hash does not link';
			end if;
		end if;
		perform assert_full_history_lcm_batch_dataset_set(new."last_batch_id");
		return new;
	end
	$$
`;

export const restoreFullHistoryLedgerCloseMetaRangeSql = `
	do $$
	begin
		if exists (
			select 1 from "full_history_ledger_close_meta_batch"
			where "start_ledger" = 2 and "end_ledger" = 2
		) then
			raise exception 'cannot remove ledger-two support while the immutable batch exists';
		end if;
	end
	$$;

	alter table "full_history_ledger_close_meta_batch"
		drop constraint "chk_full_history_lcm_batch_range";
	alter table "full_history_ledger_close_meta_batch"
		add constraint "chk_full_history_lcm_batch_range" check (
			"start_ledger" between 1 and 4294967295
			and "end_ledger" between "start_ledger" and 4294967295
			and "ledger_count" = "end_ledger" - "start_ledger" + 1
			and "ledger_count" between 64 and 1024
		);

	create or replace function validate_full_history_lcm_watermark_advance()
	returns trigger language plpgsql as $$
	declare
		batch_record "full_history_ledger_close_meta_batch"%rowtype;
		previous_batch "full_history_ledger_close_meta_batch"%rowtype;
	begin
		if tg_op = 'DELETE' then
			raise exception 'full-history LedgerCloseMeta watermark deletion is prohibited';
		end if;
		if tg_op = 'INSERT' then
			if new."last_batch_id" is not null
				or new."next_ledger" <> new."first_available_ledger"
				or new."version" <> 0 then
				raise exception 'full-history LedgerCloseMeta watermark must start at its first available ledger';
			end if;
			return new;
		end if;
		if new."network_passphrase_hash" <> old."network_passphrase_hash"
			or new."first_available_ledger" <> old."first_available_ledger" then
			raise exception 'full-history LedgerCloseMeta watermark identity is immutable';
		end if;
		if new."version" <> old."version" + 1 then
			raise exception 'full-history LedgerCloseMeta watermark version must advance once';
		end if;
		select * into strict batch_record
		from "full_history_ledger_close_meta_batch"
		where "id" = new."last_batch_id" for key share;
		if batch_record."network_passphrase_hash" <>
				new."network_passphrase_hash"
			or batch_record."start_ledger" <> old."next_ledger"
			or batch_record."end_ledger" + 1 <> new."next_ledger" then
			raise exception 'full-history LedgerCloseMeta watermark must advance one contiguous batch';
		end if;
		if old."last_batch_id" is not null then
			select * into strict previous_batch
			from "full_history_ledger_close_meta_batch"
			where "id" = old."last_batch_id" for key share;
			if previous_batch."last_ledger_hash" <>
					batch_record."first_previous_ledger_hash" then
				raise exception 'full-history LedgerCloseMeta watermark chain hash does not link';
			end if;
		end if;
		perform assert_full_history_lcm_batch_dataset_set(new."last_batch_id");
		return new;
	end
	$$
`;
