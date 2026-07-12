export const archiveEvidenceSummaryBatchSize = 100_000;
export const archiveEvidenceSummaryLockTimeoutMs = 2_000;
export const archiveEvidenceSummaryStatementTimeoutMs = 30_000;

export const archiveEvidenceSummaryMigrationLockSql = `
	select pg_try_advisory_lock(1784950000, -1) as acquired
`;

export const archiveEvidenceSummaryMigrationUnlockSql = `
	select pg_advisory_unlock(1784950000, -1)
`;

export const archiveEvidenceSummaryGlobalExclusiveLockSql = `
	select pg_advisory_xact_lock(1784950000, 0)
`;

export const archiveEvidenceSummaryBatchBoundarySql = `
	select least(
		coalesce(max(id), $2::bigint),
		$2::bigint
	)::text as "batchEndObjectId"
	from (
		select id
		from history_archive_object_queue
		where id > $1::bigint
		order by id
		limit $3::integer
	) batch_ids
`;

const archiveEvidenceSummaryBatchSelectSql = `
	select id, "archiveUrlIdentity", "objectType", status, "failureChannel"
	from history_archive_object_queue
	where id > $1::bigint
		and id <= $2::bigint
	order by id
	limit $3::integer
`;

export const archiveEvidenceSummaryBatchSql = `
	with batch as materialized (
		${archiveEvidenceSummaryBatchSelectSql}
	), grouped as (
		select
			"archiveUrlIdentity",
			count(*) as total,
			count(*) filter (where status = 'pending') as pending,
			count(*) filter (where status = 'scanning') as active,
			count(*) filter (where status = 'verified') as verified,
			count(*) filter (
				where status = 'failed'
					and "failureChannel" = 'archive_evidence'
			) as remote_failure,
			count(*) filter (
				where status = 'failed'
					and "failureChannel" = 'scanner_issue'
			) as worker_issue,
			count(*) filter (where "objectType" = 'bucket') as bucket,
			count(*) filter (
				where "objectType" = 'bucket' and status = 'verified'
			) as verified_bucket
		from batch
		group by "archiveUrlIdentity"
	), summary_write as (
		insert into history_archive_evidence_root_summary (
			"archiveUrlIdentity", "totalObjects", "pendingObjects",
			"activeObjects", "verifiedObjects", "remoteFailureObjects",
			"workerIssueObjects", "bucketObjects", "verifiedBucketObjects",
			"updatedAt"
		)
		select "archiveUrlIdentity", total, pending, active, verified,
			remote_failure, worker_issue, bucket, verified_bucket, now()
		from grouped
		on conflict ("archiveUrlIdentity") do update set
			"totalObjects" =
				history_archive_evidence_root_summary."totalObjects"
				+ excluded."totalObjects",
			"pendingObjects" =
				history_archive_evidence_root_summary."pendingObjects"
				+ excluded."pendingObjects",
			"activeObjects" =
				history_archive_evidence_root_summary."activeObjects"
				+ excluded."activeObjects",
			"verifiedObjects" =
				history_archive_evidence_root_summary."verifiedObjects"
				+ excluded."verifiedObjects",
			"remoteFailureObjects" =
				history_archive_evidence_root_summary."remoteFailureObjects"
				+ excluded."remoteFailureObjects",
			"workerIssueObjects" =
				history_archive_evidence_root_summary."workerIssueObjects"
				+ excluded."workerIssueObjects",
			"bucketObjects" =
				history_archive_evidence_root_summary."bucketObjects"
				+ excluded."bucketObjects",
			"verifiedBucketObjects" =
				history_archive_evidence_root_summary."verifiedBucketObjects"
				+ excluded."verifiedBucketObjects",
			"updatedAt" = now()
		returning 1
	), progress_write as (
		update history_archive_evidence_root_summary_progress
		set "lastObjectId" = $2::bigint, "updatedAt" = now()
		where id = 1
		returning "lastObjectId", "cutoffObjectId"
	)
	select
		(select count(*)::int from batch) as "batchCount",
		"lastObjectId"::text as "lastObjectId",
		"cutoffObjectId"::text as "cutoffObjectId"
	from progress_write
`;

export const archiveEvidenceSummaryTriggerFunctionSql = `
	create or replace function refresh_history_archive_evidence_root_summary()
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
			and old.status = new.status
			and old."objectType" = new."objectType"
			and old."failureChannel" is not distinct from new."failureChannel"
		then
			return new;
		end if;

		perform pg_advisory_xact_lock_shared(1784950000, 0);
		select "complete", "cutoffObjectId", "lastObjectId"
		into progress_complete, cutoff_object_id, last_object_id
		from history_archive_evidence_root_summary_progress
		where id = 1;

		if tg_op in ('DELETE', 'UPDATE') then
			old_hash := hashtext(old."archiveUrlIdentity");
		end if;
		if tg_op in ('INSERT', 'UPDATE') then
			new_hash := hashtext(new."archiveUrlIdentity");
		end if;
		if tg_op = 'UPDATE' and old_hash <> new_hash then
			perform pg_advisory_xact_lock(1784950001, least(old_hash, new_hash));
			perform pg_advisory_xact_lock(1784950001, greatest(old_hash, new_hash));
		else
			perform pg_advisory_xact_lock(
				1784950001,
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
			update history_archive_evidence_root_summary set
				"totalObjects" = "totalObjects" - 1,
				"pendingObjects" = "pendingObjects"
					- (old.status = 'pending')::integer,
				"activeObjects" = "activeObjects"
					- (old.status = 'scanning')::integer,
				"verifiedObjects" = "verifiedObjects"
					- (old.status = 'verified')::integer,
				"remoteFailureObjects" = "remoteFailureObjects" - coalesce((
					old.status = 'failed'
					and old."failureChannel" = 'archive_evidence'
				), false)::integer,
				"workerIssueObjects" = "workerIssueObjects" - coalesce((
					old.status = 'failed'
					and old."failureChannel" = 'scanner_issue'
				), false)::integer,
				"bucketObjects" = "bucketObjects"
					- (old."objectType" = 'bucket')::integer,
				"verifiedBucketObjects" = "verifiedBucketObjects"
					- (old."objectType" = 'bucket'
						and old.status = 'verified')::integer,
				"updatedAt" = now()
			where "archiveUrlIdentity" = old."archiveUrlIdentity";

			delete from history_archive_evidence_root_summary
			where "archiveUrlIdentity" = old."archiveUrlIdentity"
				and "totalObjects" = 0;
		end if;

		if tg_op in ('INSERT', 'UPDATE') and new_tracked then
			insert into history_archive_evidence_root_summary (
				"archiveUrlIdentity", "totalObjects", "pendingObjects",
				"activeObjects", "verifiedObjects", "remoteFailureObjects",
				"workerIssueObjects", "bucketObjects", "verifiedBucketObjects",
				"updatedAt"
			) values (
				new."archiveUrlIdentity", 1,
				(new.status = 'pending')::integer,
				(new.status = 'scanning')::integer,
				(new.status = 'verified')::integer,
				coalesce((new.status = 'failed'
					and new."failureChannel" = 'archive_evidence'), false)::integer,
				coalesce((new.status = 'failed'
					and new."failureChannel" = 'scanner_issue'), false)::integer,
				(new."objectType" = 'bucket')::integer,
				(new."objectType" = 'bucket'
					and new.status = 'verified')::integer,
				now()
			)
			on conflict ("archiveUrlIdentity") do update set
				"totalObjects" =
					history_archive_evidence_root_summary."totalObjects" + 1,
				"pendingObjects" =
					history_archive_evidence_root_summary."pendingObjects"
					+ excluded."pendingObjects",
				"activeObjects" =
					history_archive_evidence_root_summary."activeObjects"
					+ excluded."activeObjects",
				"verifiedObjects" =
					history_archive_evidence_root_summary."verifiedObjects"
					+ excluded."verifiedObjects",
				"remoteFailureObjects" =
					history_archive_evidence_root_summary."remoteFailureObjects"
					+ excluded."remoteFailureObjects",
				"workerIssueObjects" =
					history_archive_evidence_root_summary."workerIssueObjects"
					+ excluded."workerIssueObjects",
				"bucketObjects" =
					history_archive_evidence_root_summary."bucketObjects"
					+ excluded."bucketObjects",
				"verifiedBucketObjects" =
					history_archive_evidence_root_summary."verifiedBucketObjects"
					+ excluded."verifiedBucketObjects",
				"updatedAt" = now();
		end if;

		return case when tg_op = 'DELETE' then old else new end;
	end;
	$function$
`;

export const archiveEvidenceSummaryTruncateFunctionSql = `
	create or replace function reset_history_archive_evidence_root_summary()
	returns trigger
	language plpgsql
	as $function$
	begin
		perform pg_advisory_xact_lock(1784950000, 0);
		truncate history_archive_evidence_root_summary;
		update history_archive_evidence_root_summary_progress
		set "cutoffObjectId" = 0, "lastObjectId" = 0,
			"complete" = true, "updatedAt" = now()
		where id = 1;
		return null;
	end;
	$function$
`;
