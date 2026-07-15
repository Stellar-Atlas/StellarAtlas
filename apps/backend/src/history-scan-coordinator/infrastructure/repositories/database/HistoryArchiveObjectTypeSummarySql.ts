export const archiveObjectTypeSummaryBatchSize = 100_000;
export const archiveObjectTypeSummaryLockTimeoutMs = 2_000;
export const archiveObjectTypeSummaryStatementTimeoutMs = 30_000;

export const archiveObjectTypeSummaryMigrationLockSql = `
	select pg_try_advisory_lock(1785080000, -1) as acquired
`;

export const archiveObjectTypeSummaryMigrationUnlockSql = `
	select pg_advisory_unlock(1785080000, -1)
`;

export const archiveObjectTypeSummaryGlobalExclusiveLockSql = `
	select pg_advisory_xact_lock(1785080000, 0)
`;

export const archiveObjectTypeSummaryBatchBoundarySql = `
	select coalesce(
		(
			select max(id)
			from (
				select id
				from history_archive_object_queue
				where id > $1::bigint
					and id <= $2::bigint
				order by id
				limit $3::integer
			) batch_ids
		),
		$2::bigint
	)::text as "batchEndObjectId"
`;

const archiveObjectTypeSummaryBatchSelectSql = `
	select id, "archiveUrlIdentity", "objectType", status, "failureChannel"
	from history_archive_object_queue
	where id > $1::bigint
		and id <= $2::bigint
	order by id
	limit $3::integer
`;

export const archiveObjectTypeSummaryBatchSql = `
	with batch as materialized (
		${archiveObjectTypeSummaryBatchSelectSql}
	), grouped as (
		select
			"archiveUrlIdentity",
			"objectType",
			count(*) as total,
			count(*) filter (where status = 'pending') as pending,
			count(*) filter (where status = 'scanning') as scanning,
			count(*) filter (where status = 'verified') as verified,
			count(*) filter (
				where status = 'failed'
					and "failureChannel" = 'archive_evidence'
			) as remote_failure,
			count(*) filter (
				where status = 'failed'
					and "failureChannel" = 'scanner_issue'
			) as scanner_issue
		from batch
		group by "archiveUrlIdentity", "objectType"
	), summary_write as (
		insert into history_archive_object_type_summary (
			"archiveUrlIdentity", "objectType", "totalObjects",
			"pendingObjects", "scanningObjects", "verifiedObjects",
			"remoteFailureObjects", "scannerIssueObjects", "updatedAt"
		)
		select "archiveUrlIdentity", "objectType", total, pending, scanning,
			verified, remote_failure, scanner_issue, now()
		from grouped
		on conflict ("archiveUrlIdentity", "objectType") do update set
			"totalObjects" =
				history_archive_object_type_summary."totalObjects"
				+ excluded."totalObjects",
			"pendingObjects" =
				history_archive_object_type_summary."pendingObjects"
				+ excluded."pendingObjects",
			"scanningObjects" =
				history_archive_object_type_summary."scanningObjects"
				+ excluded."scanningObjects",
			"verifiedObjects" =
				history_archive_object_type_summary."verifiedObjects"
				+ excluded."verifiedObjects",
			"remoteFailureObjects" =
				history_archive_object_type_summary."remoteFailureObjects"
				+ excluded."remoteFailureObjects",
			"scannerIssueObjects" =
				history_archive_object_type_summary."scannerIssueObjects"
				+ excluded."scannerIssueObjects",
			"updatedAt" = now()
		returning 1
	), progress_write as (
		update history_archive_object_type_summary_progress
		set "lastObjectId" = $2::bigint, "updatedAt" = now()
		where id = 1
		returning "lastObjectId", "cutoffObjectId"
	)
	select
		(select count(*)::integer from batch) as "batchCount",
		"lastObjectId"::text as "lastObjectId",
		"cutoffObjectId"::text as "cutoffObjectId"
	from progress_write
`;

export const archiveObjectTypeSummaryTriggerFunctionSql = `
	create or replace function refresh_history_archive_object_type_summary()
	returns trigger
	language plpgsql
	as $function$
	declare
		progress_complete boolean := false;
		cutoff_object_id bigint := 0;
		last_object_id bigint := 0;
		old_tracked boolean := false;
		new_tracked boolean := false;
		old_hash integer;
		new_hash integer;
	begin
		if tg_op = 'UPDATE'
			and old.id = new.id
			and old."archiveUrlIdentity" = new."archiveUrlIdentity"
			and old."objectType" = new."objectType"
			and old.status = new.status
			and old."failureChannel" is not distinct from new."failureChannel"
		then
			return new;
		end if;

		perform pg_advisory_xact_lock_shared(1785080000, 0);
		select "complete", "cutoffObjectId", "lastObjectId"
		into progress_complete, cutoff_object_id, last_object_id
		from history_archive_object_type_summary_progress
		where id = 1;

		if tg_op in ('DELETE', 'UPDATE') then
			old_hash := hashtext(
				old."archiveUrlIdentity" || chr(31) || old."objectType"
			);
		end if;
		if tg_op in ('INSERT', 'UPDATE') then
			new_hash := hashtext(
				new."archiveUrlIdentity" || chr(31) || new."objectType"
			);
		end if;
		if tg_op = 'UPDATE' and old_hash <> new_hash then
			perform pg_advisory_xact_lock(1785080001, least(old_hash, new_hash));
			perform pg_advisory_xact_lock(1785080001, greatest(old_hash, new_hash));
		else
			perform pg_advisory_xact_lock(
				1785080001,
				case when tg_op = 'DELETE' then old_hash else new_hash end
			);
		end if;

		if tg_op in ('DELETE', 'UPDATE') then
			old_tracked := progress_complete
				or old.id <= last_object_id
				or old.id > cutoff_object_id;
		end if;
		if tg_op in ('INSERT', 'UPDATE') then
			new_tracked := progress_complete
				or new.id <= last_object_id
				or new.id > cutoff_object_id;
		end if;

		if tg_op in ('DELETE', 'UPDATE') and old_tracked then
			update history_archive_object_type_summary set
				"totalObjects" = "totalObjects" - 1,
				"pendingObjects" = "pendingObjects"
					- (old.status = 'pending')::integer,
				"scanningObjects" = "scanningObjects"
					- (old.status = 'scanning')::integer,
				"verifiedObjects" = "verifiedObjects"
					- (old.status = 'verified')::integer,
				"remoteFailureObjects" = "remoteFailureObjects" - coalesce((
					old.status = 'failed'
					and old."failureChannel" = 'archive_evidence'
				), false)::integer,
				"scannerIssueObjects" = "scannerIssueObjects" - coalesce((
					old.status = 'failed'
					and old."failureChannel" = 'scanner_issue'
				), false)::integer,
				"updatedAt" = now()
			where "archiveUrlIdentity" = old."archiveUrlIdentity"
				and "objectType" = old."objectType";

			delete from history_archive_object_type_summary
			where "archiveUrlIdentity" = old."archiveUrlIdentity"
				and "objectType" = old."objectType"
				and "totalObjects" = 0;
		end if;

		if tg_op in ('INSERT', 'UPDATE') and new_tracked then
			insert into history_archive_object_type_summary (
				"archiveUrlIdentity", "objectType", "totalObjects",
				"pendingObjects", "scanningObjects", "verifiedObjects",
				"remoteFailureObjects", "scannerIssueObjects", "updatedAt"
			) values (
				new."archiveUrlIdentity", new."objectType", 1,
				(new.status = 'pending')::integer,
				(new.status = 'scanning')::integer,
				(new.status = 'verified')::integer,
				coalesce((new.status = 'failed'
					and new."failureChannel" = 'archive_evidence'), false)::integer,
				coalesce((new.status = 'failed'
					and new."failureChannel" = 'scanner_issue'), false)::integer,
				now()
			)
			on conflict ("archiveUrlIdentity", "objectType") do update set
				"totalObjects" =
					history_archive_object_type_summary."totalObjects" + 1,
				"pendingObjects" =
					history_archive_object_type_summary."pendingObjects"
					+ excluded."pendingObjects",
				"scanningObjects" =
					history_archive_object_type_summary."scanningObjects"
					+ excluded."scanningObjects",
				"verifiedObjects" =
					history_archive_object_type_summary."verifiedObjects"
					+ excluded."verifiedObjects",
				"remoteFailureObjects" =
					history_archive_object_type_summary."remoteFailureObjects"
					+ excluded."remoteFailureObjects",
				"scannerIssueObjects" =
					history_archive_object_type_summary."scannerIssueObjects"
					+ excluded."scannerIssueObjects",
				"updatedAt" = now();
		end if;

		if tg_op = 'DELETE' then
			return old;
		end if;
		return new;
	end;
	$function$
`;

export const archiveObjectTypeSummaryTruncateFunctionSql = `
	create or replace function reset_history_archive_object_type_summary()
	returns trigger
	language plpgsql
	as $function$
	begin
		perform pg_advisory_xact_lock(1785080000, 0);
		truncate history_archive_object_type_summary;
		update history_archive_object_type_summary_progress
		set "cutoffObjectId" = 0, "lastObjectId" = 0,
			"complete" = true, "completedAt" = now(), "updatedAt" = now()
		where id = 1;
		return null;
	end;
	$function$
`;
