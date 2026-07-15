export const archiveBucketReferenceSummaryBatchSize = 1_024;
export const archiveBucketReferenceSummaryLockTimeoutMs = 2_000;
export const archiveBucketReferenceSummaryStatementTimeoutMs = 60_000;

export const archiveBucketReferenceSummaryGlobalExclusiveLockSql = `
	select pg_advisory_xact_lock(1785100000, 0)
`;

export const archiveBucketReferenceSummaryBatchBoundarySql = `
	select coalesce(max("bucketHash"), $2::text) as "batchEndBucketHash"
	from (
		select distinct "bucketHash"
		from history_archive_object_queue
		where "objectType" = 'bucket'
			and "bucketHash" is not null
			and "bucketHash" > $1::text
			and "bucketHash" <= $2::text
		order by "bucketHash"
		limit $3::integer
	) batch_hashes
`;

export const archiveBucketReferenceSummaryBatchSql = `
	with source_batch as materialized (
		select "archiveUrlIdentity", "bucketHash", count(*) as reference_count
		from history_archive_object_queue
		where "objectType" = 'bucket'
			and "bucketHash" is not null
			and "bucketHash" > $1::text
			and "bucketHash" <= $2::text
		group by "archiveUrlIdentity", "bucketHash"
	), source_write as (
		insert into history_archive_bucket_reference_summary (
			"archiveUrlIdentity", "bucketHash", "referenceCount", "updatedAt"
		)
		select "archiveUrlIdentity", "bucketHash", reference_count, now()
		from source_batch
		on conflict ("archiveUrlIdentity", "bucketHash") do update set
			"referenceCount" =
				history_archive_bucket_reference_summary."referenceCount"
				+ excluded."referenceCount",
			"updatedAt" = now()
		returning "bucketHash", "referenceCount"
	), global_batch as (
		select "bucketHash", sum(reference_count) as reference_count
		from source_batch
		group by "bucketHash"
	), global_write as (
		insert into history_archive_bucket_identity_summary (
			"bucketHash", "referenceCount", "updatedAt"
		)
		select "bucketHash", reference_count, now()
		from global_batch
		on conflict ("bucketHash") do update set
			"referenceCount" =
				history_archive_bucket_identity_summary."referenceCount"
				+ excluded."referenceCount",
			"updatedAt" = now()
		returning "bucketHash", "referenceCount"
	), progress_write as (
		update history_archive_bucket_reference_summary_progress
		set "lastBucketHash" = $2::text, "updatedAt" = now()
		where id = 1
		returning "lastBucketHash", "cutoffBucketHash"
	)
	select "lastBucketHash", "cutoffBucketHash",
		(select count(*)::integer from source_write) as "sourceRows",
		(select count(*)::integer from global_write) as "globalRows"
	from progress_write
`;

export const archiveBucketReferenceSummaryTriggerFunctionSql = `
	create or replace function refresh_history_archive_bucket_reference_summary()
	returns trigger
	language plpgsql
	as $function$
	declare
		progress_complete boolean := false;
		cutoff_hash text := '';
		last_hash text := '';
		old_bucket boolean := false;
		new_bucket boolean := false;
		old_tracked boolean := false;
		new_tracked boolean := false;
		old_lock integer;
		new_lock integer;
	begin
		if tg_op = 'UPDATE'
			and old."archiveUrlIdentity" = new."archiveUrlIdentity"
			and old."objectType" = new."objectType"
			and old."bucketHash" is not distinct from new."bucketHash"
		then
			return new;
		end if;

		perform pg_advisory_xact_lock_shared(1785100000, 0);
		select "complete", "cutoffBucketHash", "lastBucketHash"
		into progress_complete, cutoff_hash, last_hash
		from history_archive_bucket_reference_summary_progress
		where id = 1;

		if tg_op in ('DELETE', 'UPDATE') then
			old_bucket := old."objectType" = 'bucket'
				and old."bucketHash" is not null;
			if old_bucket then
				old_lock := hashtext(old."bucketHash");
				old_tracked := progress_complete
					or old."bucketHash" <= last_hash
					or old."bucketHash" > cutoff_hash;
			end if;
		end if;
		if tg_op in ('INSERT', 'UPDATE') then
			new_bucket := new."objectType" = 'bucket'
				and new."bucketHash" is not null;
			if new_bucket then
				new_lock := hashtext(new."bucketHash");
				new_tracked := progress_complete
					or new."bucketHash" <= last_hash
					or new."bucketHash" > cutoff_hash;
			end if;
		end if;

		if old_bucket and new_bucket and old_lock <> new_lock then
			perform pg_advisory_xact_lock(1785100001, least(old_lock, new_lock));
			perform pg_advisory_xact_lock(1785100001, greatest(old_lock, new_lock));
		elsif old_bucket or new_bucket then
			perform pg_advisory_xact_lock(
				1785100001, case when old_bucket then old_lock else new_lock end
			);
		end if;

		if old_tracked then
			delete from history_archive_bucket_reference_summary
			where "archiveUrlIdentity" = old."archiveUrlIdentity"
				and "bucketHash" = old."bucketHash" and "referenceCount" = 1;
			if not found then
				update history_archive_bucket_reference_summary
				set "referenceCount" = "referenceCount" - 1, "updatedAt" = now()
				where "archiveUrlIdentity" = old."archiveUrlIdentity"
					and "bucketHash" = old."bucketHash" and "referenceCount" > 1;
				if not found then
					raise exception 'Missing archive bucket source reference summary';
				end if;
			end if;

			delete from history_archive_bucket_identity_summary
			where "bucketHash" = old."bucketHash" and "referenceCount" = 1;
			if not found then
				update history_archive_bucket_identity_summary
				set "referenceCount" = "referenceCount" - 1, "updatedAt" = now()
				where "bucketHash" = old."bucketHash" and "referenceCount" > 1;
				if not found then
					raise exception 'Missing archive bucket global reference summary';
				end if;
			end if;
		end if;

		if new_tracked then
			insert into history_archive_bucket_reference_summary (
				"archiveUrlIdentity", "bucketHash", "referenceCount", "updatedAt"
			) values (new."archiveUrlIdentity", new."bucketHash", 1, now())
			on conflict ("archiveUrlIdentity", "bucketHash") do update set
				"referenceCount" =
					history_archive_bucket_reference_summary."referenceCount" + 1,
				"updatedAt" = now();

			insert into history_archive_bucket_identity_summary (
				"bucketHash", "referenceCount", "updatedAt"
			) values (new."bucketHash", 1, now())
			on conflict ("bucketHash") do update set
				"referenceCount" =
					history_archive_bucket_identity_summary."referenceCount" + 1,
				"updatedAt" = now();
		end if;

		if tg_op = 'DELETE' then return old; end if;
		return new;
	end;
	$function$
`;

export const archiveBucketReferenceSummaryTruncateFunctionSql = `
	create or replace function reset_history_archive_bucket_reference_summary()
	returns trigger
	language plpgsql
	as $function$
	begin
		perform pg_advisory_xact_lock(1785100000, 0);
		truncate history_archive_bucket_reference_summary;
		truncate history_archive_bucket_identity_summary;
		update history_archive_bucket_reference_summary_progress
		set "cutoffBucketHash" = '', "lastBucketHash" = '',
			"complete" = true, "completedAt" = now(), "updatedAt" = now()
		where id = 1;
		return null;
	end;
	$function$
`;
