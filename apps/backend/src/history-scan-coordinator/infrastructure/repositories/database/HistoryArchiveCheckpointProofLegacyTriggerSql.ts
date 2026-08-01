// This SQL is intentionally frozen for migration 178483 and rollback of the
// steady-state optimization. Do not change it when optimizing the live trigger.
export const legacyCheckpointProofRollupTriggerFunctionSql = `
	create or replace function refresh_history_archive_checkpoint_proof_rollup()
	returns trigger
	language plpgsql
	as $function$
	declare
		old_complete boolean := false;
		new_complete boolean := false;
		progress_complete boolean := false;
		old_hash integer;
		new_hash integer;
	begin
		perform pg_advisory_xact_lock_shared(1784830000, 0);
		select coalesce((
			select "complete"
			from history_archive_checkpoint_proof_rollup_progress
			where id = 1
			), false) into progress_complete;

		if tg_op in ('DELETE', 'UPDATE') then
			old_hash := hashtext(old."archiveUrlIdentity");
		end if;
		if tg_op in ('INSERT', 'UPDATE') then
			new_hash := hashtext(new."archiveUrlIdentity");
		end if;
		if tg_op = 'UPDATE' and old_hash <> new_hash then
			perform pg_advisory_xact_lock(1784830001, least(old_hash, new_hash));
			perform pg_advisory_xact_lock(1784830001, greatest(old_hash, new_hash));
		else
			perform pg_advisory_xact_lock(
				1784830001,
				case when tg_op = 'DELETE' then old_hash else new_hash end
			);
		end if;

		if tg_op in ('DELETE', 'UPDATE') then
			insert into history_archive_checkpoint_proof_rollup_state (
				"archiveUrlIdentity", "changeVersion", "backfillComplete"
			) values (old."archiveUrlIdentity", 1, progress_complete)
			on conflict ("archiveUrlIdentity") do update set
				"changeVersion" =
					history_archive_checkpoint_proof_rollup_state."changeVersion" + 1,
				"updatedAt" = now()
			returning "backfillComplete" into old_complete;
		end if;

		if tg_op = 'UPDATE'
			and old."archiveUrlIdentity" = new."archiveUrlIdentity" then
			new_complete := old_complete;
		elsif tg_op in ('INSERT', 'UPDATE') then
			insert into history_archive_checkpoint_proof_rollup_state (
				"archiveUrlIdentity", "changeVersion", "backfillComplete"
			) values (new."archiveUrlIdentity", 1, progress_complete)
			on conflict ("archiveUrlIdentity") do update set
				"changeVersion" =
					history_archive_checkpoint_proof_rollup_state."changeVersion" + 1,
				"updatedAt" = now()
			returning "backfillComplete" into new_complete;
		end if;

		if tg_op in ('DELETE', 'UPDATE') and old_complete then
			update history_archive_checkpoint_proof_rollup set
				"totalCheckpointProofs" = "totalCheckpointProofs" - 1,
				"pendingCheckpointProofs" = "pendingCheckpointProofs"
					- (old.status = 'pending')::integer,
				"verifiedCheckpointProofs" = "verifiedCheckpointProofs"
					- (old.status = 'verified')::integer,
				"mismatchCheckpointProofs" = "mismatchCheckpointProofs"
					- (old.status = 'mismatch')::integer,
				"notEvaluableCheckpointProofs" = "notEvaluableCheckpointProofs"
					- (old.status = 'not-evaluable')::integer,
				"objectCompleteCheckpointProofs" = "objectCompleteCheckpointProofs"
					- old."requiredObjectsComplete"::integer,
				"updatedAt" = now()
			where "archiveUrlIdentity" = old."archiveUrlIdentity";

			delete from history_archive_checkpoint_proof_rollup
			where "archiveUrlIdentity" = old."archiveUrlIdentity"
				and "totalCheckpointProofs" = 0;

			update history_archive_checkpoint_proof_rollup rollup set
				"oldestCheckpointLedger" = bounds.oldest,
				"latestCheckpointLedger" = bounds.latest
			from (
				select min("checkpointLedger") as oldest,
					max("checkpointLedger") as latest
				from history_archive_checkpoint_proof
				where "archiveUrlIdentity" = old."archiveUrlIdentity"
			) bounds
			where rollup."archiveUrlIdentity" = old."archiveUrlIdentity";
		end if;

		if tg_op in ('INSERT', 'UPDATE') and new_complete then
			insert into history_archive_checkpoint_proof_rollup (
				"archiveUrlIdentity", "totalCheckpointProofs",
				"pendingCheckpointProofs", "verifiedCheckpointProofs",
				"mismatchCheckpointProofs", "notEvaluableCheckpointProofs",
				"objectCompleteCheckpointProofs", "oldestCheckpointLedger",
				"latestCheckpointLedger", "updatedAt"
			) values (
				new."archiveUrlIdentity", 1,
				(new.status = 'pending')::integer,
				(new.status = 'verified')::integer,
				(new.status = 'mismatch')::integer,
				(new.status = 'not-evaluable')::integer,
				new."requiredObjectsComplete"::integer,
				new."checkpointLedger", new."checkpointLedger", now()
			)
			on conflict ("archiveUrlIdentity") do update set
				"totalCheckpointProofs" =
					history_archive_checkpoint_proof_rollup."totalCheckpointProofs" + 1,
				"pendingCheckpointProofs" =
					history_archive_checkpoint_proof_rollup."pendingCheckpointProofs"
					+ excluded."pendingCheckpointProofs",
				"verifiedCheckpointProofs" =
					history_archive_checkpoint_proof_rollup."verifiedCheckpointProofs"
					+ excluded."verifiedCheckpointProofs",
				"mismatchCheckpointProofs" =
					history_archive_checkpoint_proof_rollup."mismatchCheckpointProofs"
					+ excluded."mismatchCheckpointProofs",
				"notEvaluableCheckpointProofs" =
					history_archive_checkpoint_proof_rollup."notEvaluableCheckpointProofs"
					+ excluded."notEvaluableCheckpointProofs",
				"objectCompleteCheckpointProofs" =
					history_archive_checkpoint_proof_rollup."objectCompleteCheckpointProofs"
					+ excluded."objectCompleteCheckpointProofs",
				"oldestCheckpointLedger" = least(
					history_archive_checkpoint_proof_rollup."oldestCheckpointLedger",
					excluded."oldestCheckpointLedger"
				),
				"latestCheckpointLedger" = greatest(
					history_archive_checkpoint_proof_rollup."latestCheckpointLedger",
					excluded."latestCheckpointLedger"
				),
				"updatedAt" = now();
		end if;

		return case when tg_op = 'DELETE' then old else new end;
	end;
	$function$
`;

export const legacyCheckpointProofRollupTriggerSql = `
	create trigger "trg_history_archive_checkpoint_proof_rollup"
	after insert or update or delete
	on history_archive_checkpoint_proof
	for each row execute function
		refresh_history_archive_checkpoint_proof_rollup()
`;
