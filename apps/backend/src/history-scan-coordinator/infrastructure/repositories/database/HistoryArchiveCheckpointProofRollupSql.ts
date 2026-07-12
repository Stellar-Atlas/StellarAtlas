export const checkpointProofRollupBatchSize = 10_000;
export const checkpointProofRollupLockTimeoutMs = 2_000;
export const checkpointProofRollupStatementTimeoutMs = 15_000;
export const checkpointProofRollupFinalizeRetries = 4;

export const checkpointProofRollupMigrationLockSql = `
	select pg_try_advisory_lock(1784830000, -1) as acquired
`;

export const checkpointProofRollupMigrationUnlockSql = `
	select pg_advisory_unlock(1784830000, -1)
`;

export const checkpointProofRollupGlobalSharedLockSql = `
	select pg_advisory_xact_lock_shared(1784830000, 0)
`;

export const checkpointProofRollupGlobalExclusiveLockSql = `
	select pg_advisory_xact_lock(1784830000, 0)
`;

export const checkpointProofRollupIdentityLockSql = `
	select pg_advisory_xact_lock(1784830001, hashtext($1::text))
`;

export const checkpointProofRollupLooseIdentityCountSql = `
	with recursive identities("archiveUrlIdentity") as (
		select min("archiveUrlIdentity")
		from history_archive_checkpoint_proof
		union all
		select (
			select min(proof."archiveUrlIdentity")
			from history_archive_checkpoint_proof proof
			where proof."archiveUrlIdentity" > identities."archiveUrlIdentity"
		)
		from identities
		where identities."archiveUrlIdentity" is not null
	)
	select count(*) filter (
		where "archiveUrlIdentity" is not null
	)::text as "archiveCount"
	from identities
`;

export const checkpointProofRollupBatchBoundarySql = `
	select least(
		coalesce(max(id), $2::bigint),
		$2::bigint
	)::text as "batchEndProofId"
	from (
		select id
		from history_archive_checkpoint_proof
		where id > $1::bigint
		order by id
		limit $3::integer
	) batch_ids
`;

export const checkpointProofRollupBatchSelectSql = `
	select
		id,
		"archiveUrlIdentity",
		"checkpointLedger",
		status,
		"requiredObjectsComplete"
	from history_archive_checkpoint_proof
	where id > $1::bigint
		and id <= $2::bigint
	order by id
	limit $3::integer
`;

export const checkpointProofRollupBatchSql = `
	with batch as materialized (
		${checkpointProofRollupBatchSelectSql}
	), grouped as (
		select
			"archiveUrlIdentity",
			count(*) as total,
			count(*) filter (where status = 'pending') as pending,
			count(*) filter (where status = 'verified') as verified,
			count(*) filter (where status = 'mismatch') as mismatch,
			count(*) filter (where status = 'not-evaluable') as not_evaluable,
			count(*) filter (where "requiredObjectsComplete") as object_complete,
			min("checkpointLedger") as oldest,
			max("checkpointLedger") as latest
		from batch
		group by "archiveUrlIdentity"
	), rollup_write as (
		insert into history_archive_checkpoint_proof_rollup (
			"archiveUrlIdentity",
			"totalCheckpointProofs",
			"pendingCheckpointProofs",
			"verifiedCheckpointProofs",
			"mismatchCheckpointProofs",
			"notEvaluableCheckpointProofs",
			"objectCompleteCheckpointProofs",
			"oldestCheckpointLedger",
			"latestCheckpointLedger",
			"updatedAt"
		)
		select "archiveUrlIdentity", total, pending, verified, mismatch,
			not_evaluable, object_complete, oldest, latest, now()
		from grouped
		on conflict ("archiveUrlIdentity") do update set
			"totalCheckpointProofs" =
				history_archive_checkpoint_proof_rollup."totalCheckpointProofs"
				+ excluded."totalCheckpointProofs",
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
			"updatedAt" = now()
		returning 1
	), state_write as (
		insert into history_archive_checkpoint_proof_rollup_state (
			"archiveUrlIdentity"
		)
		select "archiveUrlIdentity" from grouped
		on conflict ("archiveUrlIdentity") do nothing
		returning 1
	), progress_write as (
		update history_archive_checkpoint_proof_rollup_progress
		set
			"lastProofId" = $2::bigint,
			"updatedAt" = now()
		where id = 1
		returning "lastProofId", "cutoffProofId"
	)
	select
		(select count(*)::int from batch) as "batchCount",
		(select count(*)::int from rollup_write) as "rollupWrites",
		(select count(*)::int from state_write) as "stateWrites",
		"lastProofId"::text as "lastProofId",
		"cutoffProofId"::text as "cutoffProofId"
	from progress_write
`;

export const checkpointProofRollupPendingStateSql = `
	select
		"archiveUrlIdentity",
		"changeVersion"::text as "changeVersion"
	from history_archive_checkpoint_proof_rollup_state
	where not "backfillComplete"
	order by "archiveUrlIdentity"
	limit 1
`;

export const checkpointProofRollupArchiveAggregateSql = `
	select
		count(*)::text as total,
		count(*) filter (where status = 'pending')::text as pending,
		count(*) filter (where status = 'verified')::text as verified,
		count(*) filter (where status = 'mismatch')::text as mismatch,
		count(*) filter (where status = 'not-evaluable')::text as "notEvaluable",
		count(*) filter (where "requiredObjectsComplete")::text as "objectComplete",
		min("checkpointLedger") as oldest,
		max("checkpointLedger") as latest
	from history_archive_checkpoint_proof
	where "archiveUrlIdentity" = $1
`;

export const checkpointProofRollupTriggerFunctionSql = `
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
