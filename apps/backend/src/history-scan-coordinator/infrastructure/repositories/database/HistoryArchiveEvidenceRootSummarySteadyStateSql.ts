export const archiveEvidenceRootSummarySteadyStateTriggerFunctionSql = `
	create or replace function refresh_history_archive_evidence_root_summary()
	returns trigger
	language plpgsql
	as $function$
	declare
		old_hash integer;
		new_hash integer;
		same_key boolean := false;
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

		if tg_op in ('DELETE', 'UPDATE') then
			old_hash := hashtext(old."archiveUrlIdentity");
		end if;
		if tg_op in ('INSERT', 'UPDATE') then
			new_hash := hashtext(new."archiveUrlIdentity");
		end if;

		if tg_op = 'UPDATE' then
			same_key := old."archiveUrlIdentity" = new."archiveUrlIdentity";
			if old_hash = new_hash then
				perform pg_advisory_xact_lock(1784950001, old_hash);
			else
				perform pg_advisory_xact_lock(
					1784950001,
					least(old_hash, new_hash)
				);
				perform pg_advisory_xact_lock(
					1784950001,
					greatest(old_hash, new_hash)
				);
			end if;
		elsif tg_op = 'DELETE' then
			perform pg_advisory_xact_lock(1784950001, old_hash);
		else
			perform pg_advisory_xact_lock(1784950001, new_hash);
		end if;

		if tg_op = 'UPDATE' and same_key then
			update history_archive_evidence_root_summary set
				"pendingObjects" = "pendingObjects"
					+ (new.status = 'pending')::integer
					- (old.status = 'pending')::integer,
				"activeObjects" = "activeObjects"
					+ (new.status = 'scanning')::integer
					- (old.status = 'scanning')::integer,
				"verifiedObjects" = "verifiedObjects"
					+ (new.status = 'verified')::integer
					- (old.status = 'verified')::integer,
				"remoteFailureObjects" = "remoteFailureObjects"
					+ coalesce((new.status = 'failed' and new."failureChannel"
						= 'archive_evidence'), false)::integer
					- coalesce((old.status = 'failed' and old."failureChannel"
						= 'archive_evidence'), false)::integer,
				"workerIssueObjects" = "workerIssueObjects"
					+ coalesce((new.status = 'failed' and new."failureChannel"
						= 'scanner_issue'), false)::integer
					- coalesce((old.status = 'failed' and old."failureChannel"
						= 'scanner_issue'), false)::integer,
				"bucketObjects" = "bucketObjects"
					+ (new."objectType" = 'bucket')::integer
					- (old."objectType" = 'bucket')::integer,
				"verifiedBucketObjects" = "verifiedBucketObjects"
					+ (new."objectType" = 'bucket'
						and new.status = 'verified')::integer
					- (old."objectType" = 'bucket'
						and old.status = 'verified')::integer,
				"updatedAt" = now()
			where "archiveUrlIdentity" = old."archiveUrlIdentity";
			if not found then
				raise exception 'Archive evidence root summary row is missing';
			end if;
			return new;
		end if;

		if tg_op in ('DELETE', 'UPDATE') then
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
			if not found then
				raise exception 'Archive evidence root summary row is missing';
			end if;

			delete from history_archive_evidence_root_summary
			where "archiveUrlIdentity" = old."archiveUrlIdentity"
				and "totalObjects" = 0;
		end if;

		if tg_op in ('INSERT', 'UPDATE') then
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
				coalesce((new.status = 'failed' and new."failureChannel"
					= 'archive_evidence'), false)::integer,
				coalesce((new.status = 'failed' and new."failureChannel"
					= 'scanner_issue'), false)::integer,
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
