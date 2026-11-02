// Versioned replacement; do not change historical migration SQL helpers.
// Root preimage: HistoryArchiveEvidenceRootSummarySteadyStateSql.ts
// SHA256: 30bed0c03048664bd01fdcbde6626868111558e11bbc9bb10099689ce95163b8
export const archiveFailureSummaryRevisionColumnsSql = `
	create sequence history_archive_failure_summary_revision_seq as bigint no cycle;
	alter table history_archive_evidence_root_summary
		add column "failureSummaryRevision" bigint not null default 0;
	alter table history_archive_retained_remote_summary
		add column "failureSummaryRevision" bigint not null default 0;
`;

export const archiveEvidenceRootSummaryRevisionTriggerFunctionSql = `
	create or replace function refresh_history_archive_evidence_root_summary()
	returns trigger
	language plpgsql
	as $function$
	declare
		old_hash integer;
		new_hash integer;
		same_key boolean := false;
		failure_input_changed boolean := false;
		root_revision bigint;
	begin
		if tg_op = 'INSERT' then
			failure_input_changed := new.status = 'failed';
			if not failure_input_changed then
				select exists (select 1 from history_archive_retained_remote_finding finding
					where finding."objectRemoteId" = new."remoteId" and finding."retainedOnly")
				into failure_input_changed;
			end if;
		elsif tg_op = 'DELETE' then
			failure_input_changed := old.status = 'failed';
			if not failure_input_changed then
				select exists (select 1 from history_archive_retained_remote_finding finding
					where finding."objectRemoteId" = old."remoteId" and finding."retainedOnly")
				into failure_input_changed;
			end if;
		else
			failure_input_changed := (old.status = 'failed' or new.status = 'failed')
				and row(old."archiveUrlIdentity", old."objectType", old.status,
					old."failureChannel", old."errorType", old."errorMessage",
					old."httpStatus", old."checkpointLedger", old."remoteId")
				is distinct from row(new."archiveUrlIdentity", new."objectType", new.status,
					new."failureChannel", new."errorType", new."errorMessage",
					new."httpStatus", new."checkpointLedger", new."remoteId");
			if not failure_input_changed and
				row(old."remoteId", old."archiveUrlIdentity", old."checkpointLedger")
				is distinct from row(new."remoteId", new."archiveUrlIdentity", new."checkpointLedger")
			then
				select exists (select 1 from history_archive_retained_remote_finding finding
					where finding."objectRemoteId" in (old."remoteId", new."remoteId")
						and finding."retainedOnly") into failure_input_changed;
			end if;
		end if;

		if tg_op = 'UPDATE'
			and old.id = new.id
			and old."archiveUrlIdentity" = new."archiveUrlIdentity"
			and old.status = new.status
			and old."objectType" = new."objectType"
			and old."failureChannel" is not distinct from new."failureChannel"
			and not failure_input_changed
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
				perform pg_advisory_xact_lock(1784950001, least(old_hash, new_hash));
				perform pg_advisory_xact_lock(1784950001, greatest(old_hash, new_hash));
			end if;
		elsif tg_op = 'DELETE' then
			perform pg_advisory_xact_lock(1784950001, old_hash);
		else
			perform pg_advisory_xact_lock(1784950001, new_hash);
		end if;

		if tg_op = 'UPDATE' and same_key then
			update history_archive_evidence_root_summary set
				"pendingObjects" = "pendingObjects"
					+ (new.status = 'pending')::integer - (old.status = 'pending')::integer,
				"activeObjects" = "activeObjects"
					+ (new.status = 'scanning')::integer - (old.status = 'scanning')::integer,
				"verifiedObjects" = "verifiedObjects"
					+ (new.status = 'verified')::integer - (old.status = 'verified')::integer,
				"remoteFailureObjects" = "remoteFailureObjects"
					+ coalesce((new.status = 'failed' and new."failureChannel"
						in ('archive_evidence', 'archive_availability')), false)::integer
					- coalesce((old.status = 'failed' and old."failureChannel"
						in ('archive_evidence', 'archive_availability')), false)::integer,
				"workerIssueObjects" = "workerIssueObjects"
					+ coalesce((new.status = 'failed' and new."failureChannel"
						= 'scanner_issue'), false)::integer
					- coalesce((old.status = 'failed' and old."failureChannel"
						= 'scanner_issue'), false)::integer,
				"bucketObjects" = "bucketObjects"
					+ (new."objectType" = 'bucket')::integer - (old."objectType" = 'bucket')::integer,
				"verifiedBucketObjects" = "verifiedBucketObjects"
					+ (new."objectType" = 'bucket' and new.status = 'verified')::integer
					- (old."objectType" = 'bucket' and old.status = 'verified')::integer,
				"failureSummaryRevision" = case when failure_input_changed
					then nextval('history_archive_failure_summary_revision_seq')
					else "failureSummaryRevision" end,
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
				"pendingObjects" = "pendingObjects" - (old.status = 'pending')::integer,
				"activeObjects" = "activeObjects" - (old.status = 'scanning')::integer,
				"verifiedObjects" = "verifiedObjects" - (old.status = 'verified')::integer,
				"remoteFailureObjects" = "remoteFailureObjects" - coalesce((
					old.status = 'failed' and old."failureChannel"
						in ('archive_evidence', 'archive_availability')), false)::integer,
				"workerIssueObjects" = "workerIssueObjects" - coalesce((
					old.status = 'failed' and old."failureChannel" = 'scanner_issue'), false)::integer,
				"bucketObjects" = "bucketObjects" - (old."objectType" = 'bucket')::integer,
				"verifiedBucketObjects" = "verifiedBucketObjects"
					- (old."objectType" = 'bucket' and old.status = 'verified')::integer,
				"failureSummaryRevision" = case when failure_input_changed
					then nextval('history_archive_failure_summary_revision_seq')
					else "failureSummaryRevision" end,
				"updatedAt" = now()
			where "archiveUrlIdentity" = old."archiveUrlIdentity";
			if not found then
				raise exception 'Archive evidence root summary row is missing';
			end if;
			delete from history_archive_evidence_root_summary
			where "archiveUrlIdentity" = old."archiveUrlIdentity" and "totalObjects" = 0;
		end if;

		if tg_op in ('INSERT', 'UPDATE') then
			insert into history_archive_evidence_root_summary (
				"archiveUrlIdentity", "totalObjects", "pendingObjects", "activeObjects",
				"verifiedObjects", "remoteFailureObjects", "workerIssueObjects",
				"bucketObjects", "verifiedBucketObjects", "updatedAt", "failureSummaryRevision"
			) values (
				new."archiveUrlIdentity", 1,
				(new.status = 'pending')::integer,
				(new.status = 'scanning')::integer,
				(new.status = 'verified')::integer,
				coalesce((new.status = 'failed' and new."failureChannel"
					in ('archive_evidence', 'archive_availability')), false)::integer,
				coalesce((new.status = 'failed' and new."failureChannel" = 'scanner_issue'), false)::integer,
				(new."objectType" = 'bucket')::integer,
				(new."objectType" = 'bucket' and new.status = 'verified')::integer,
				now(), case when failure_input_changed
					then nextval('history_archive_failure_summary_revision_seq') else 0 end
			)
			on conflict ("archiveUrlIdentity") do update set
				"totalObjects" = history_archive_evidence_root_summary."totalObjects" + 1,
				"pendingObjects" = history_archive_evidence_root_summary."pendingObjects" + excluded."pendingObjects",
				"activeObjects" = history_archive_evidence_root_summary."activeObjects" + excluded."activeObjects",
				"verifiedObjects" = history_archive_evidence_root_summary."verifiedObjects" + excluded."verifiedObjects",
				"remoteFailureObjects" = history_archive_evidence_root_summary."remoteFailureObjects" + excluded."remoteFailureObjects",
				"workerIssueObjects" = history_archive_evidence_root_summary."workerIssueObjects" + excluded."workerIssueObjects",
				"bucketObjects" = history_archive_evidence_root_summary."bucketObjects" + excluded."bucketObjects",
				"verifiedBucketObjects" = history_archive_evidence_root_summary."verifiedBucketObjects" + excluded."verifiedBucketObjects",
				"failureSummaryRevision" = case when failure_input_changed
					then excluded."failureSummaryRevision"
					else history_archive_evidence_root_summary."failureSummaryRevision" end,
				"updatedAt" = now()
			returning "failureSummaryRevision" into root_revision;
			if root_revision = 0 then
				update history_archive_evidence_root_summary
				set "failureSummaryRevision" = nextval('history_archive_failure_summary_revision_seq')
				where "archiveUrlIdentity" = new."archiveUrlIdentity"
					and "failureSummaryRevision" = 0;
			end if;
		end if;

		return case when tg_op = 'DELETE' then old else new end;
	end;
	$function$
`;
