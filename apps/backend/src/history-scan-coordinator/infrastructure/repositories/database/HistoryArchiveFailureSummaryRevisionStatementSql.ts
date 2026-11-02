// Actual deployed statement-function bodies, normalized CRLF->LF and trimmed.
// These guard the preimage; no historical helper or trigger definition is changed.
export const archiveEvidenceRootSummaryStatementPreimageSha256 = {
	insert: '3947aeca3b2ff535e75365c772b494ad99f06c1bb84237064172894b6c9e8ac7',
	update: '730acc60fcfa34a2e3e4b3e85df58572409422973ab504338ebec8f475503f25',
	delete: 'a32fa9e7c8b860dfc76c72437448fe72ca5c6d679ade1ab1f56b236c95a5a42a'
} as const;

// Only scalar finding/count inputs. Unmatched numeric IDs retain their own old
// and new roots; no queue composite or completion/verification payload is selected.
const scalarUpdateChangesSql = `
	select old_row."archiveUrlIdentity" as old_root,
		new_row."archiveUrlIdentity" as new_root,
		row(old_row.id,old_row."archiveUrlIdentity",old_row.status,
			old_row."objectType",old_row."failureChannel") is distinct from
		row(new_row.id,new_row."archiveUrlIdentity",new_row.status,
			new_row."objectType",new_row."failureChannel") as count_changed,
		(coalesce(old_row.status='failed',false) or coalesce(new_row.status='failed',false))
		and row(old_row.id,old_row."archiveUrlIdentity",old_row."objectType",old_row.status,
			old_row."failureChannel",old_row."errorType",old_row."errorMessage",
			old_row."httpStatus",old_row."checkpointLedger",old_row."remoteId") is distinct from
		row(new_row.id,new_row."archiveUrlIdentity",new_row."objectType",new_row.status,
			new_row."failureChannel",new_row."errorType",new_row."errorMessage",
			new_row."httpStatus",new_row."checkpointLedger",new_row."remoteId") as failure_changed,
		row(old_row."remoteId",old_row."archiveUrlIdentity",old_row."checkpointLedger")
			is distinct from row(new_row."remoteId",new_row."archiveUrlIdentity",new_row."checkpointLedger")
		and exists (select 1 from history_archive_retained_remote_finding finding
			where finding."objectRemoteId" in (old_row."remoteId",new_row."remoteId")
				and finding."retainedOnly") as retained_changed
	from old_rows old_row full join new_rows new_row using (id)
`;

/** Replaces exactly the two existing statement functions; never installs triggers. */
export const archiveEvidenceRootSummaryRevisionStatementFunctionsSql = `
create or replace function refresh_history_archive_evidence_root_summary_insert_statement()
returns trigger language plpgsql as $statement$
begin
	with grouped as (
		select inserted."archiveUrlIdentity", count(*)::bigint as total,
			count(*) filter(where inserted.status='pending')::bigint as pending,
			count(*) filter(where inserted.status='scanning')::bigint as active,
			count(*) filter(where inserted.status='verified')::bigint as verified,
			count(*) filter(where inserted.status='failed' and inserted."failureChannel"
				in ('archive_evidence','archive_availability'))::bigint as remote_failure,
			count(*) filter(where inserted.status='failed' and inserted."failureChannel"='scanner_issue')::bigint as worker_issue,
			count(*) filter(where inserted."objectType"='bucket')::bigint as bucket,
			count(*) filter(where inserted."objectType"='bucket' and inserted.status='verified')::bigint as verified_bucket,
			bool_or(inserted.status='failed' or retained."objectRemoteId" is not null) as dirty
		from new_rows inserted
		left join history_archive_retained_remote_finding retained
			on retained."objectRemoteId"=inserted."remoteId" and retained."retainedOnly"
		group by inserted."archiveUrlIdentity"
	)
	insert into history_archive_evidence_root_summary (
		"archiveUrlIdentity","totalObjects","pendingObjects","activeObjects",
		"verifiedObjects","remoteFailureObjects","workerIssueObjects",
		"bucketObjects","verifiedBucketObjects","updatedAt","failureSummaryRevision"
	)
	select "archiveUrlIdentity",total,pending,active,verified,remote_failure,worker_issue,
		bucket,verified_bucket,now(),case when dirty
			then nextval('history_archive_failure_summary_revision_seq') else 0 end
	from grouped order by "archiveUrlIdentity"
	on conflict ("archiveUrlIdentity") do update set
		"totalObjects"=history_archive_evidence_root_summary."totalObjects"+excluded."totalObjects",
		"pendingObjects"=history_archive_evidence_root_summary."pendingObjects"+excluded."pendingObjects",
		"activeObjects"=history_archive_evidence_root_summary."activeObjects"+excluded."activeObjects",
		"verifiedObjects"=history_archive_evidence_root_summary."verifiedObjects"+excluded."verifiedObjects",
		"remoteFailureObjects"=history_archive_evidence_root_summary."remoteFailureObjects"+excluded."remoteFailureObjects",
		"workerIssueObjects"=history_archive_evidence_root_summary."workerIssueObjects"+excluded."workerIssueObjects",
		"bucketObjects"=history_archive_evidence_root_summary."bucketObjects"+excluded."bucketObjects",
		"verifiedBucketObjects"=history_archive_evidence_root_summary."verifiedBucketObjects"+excluded."verifiedBucketObjects",
		"failureSummaryRevision"=case when excluded."failureSummaryRevision"<>0
			then excluded."failureSummaryRevision" else history_archive_evidence_root_summary."failureSummaryRevision" end,
		"updatedAt"=now();
	-- A second command can see newly inserted roots. Existing roots were seeded
	-- by migration and never acquire a nonce for ordinary healthy batch inserts.
	update history_archive_evidence_root_summary summary
	set "failureSummaryRevision"=nextval('history_archive_failure_summary_revision_seq')
	where summary."failureSummaryRevision"=0 and summary."archiveUrlIdentity" in
		(select distinct "archiveUrlIdentity" from new_rows);
	return null;
end;
$statement$;

create or replace function refresh_history_archive_evidence_root_summary_update_statement()
returns trigger language plpgsql as $statement$
declare affected_identity text;
begin
	if not exists (
		select 1 from (${scalarUpdateChangesSql}) changed
		where changed.count_changed or changed.failure_changed or changed.retained_changed
	) then return null; end if;

	-- Preserve only the pre-existing rare, matched root-identity-move rebuild.
	-- Unmatched IDs use the compact grouped old/new deltas below, not a fact scan.
	if exists (select 1 from old_rows old_row join new_rows new_row using(id)
		where old_row."archiveUrlIdentity" is distinct from new_row."archiveUrlIdentity") then
		for affected_identity in
			select "archiveUrlIdentity" from (
				select "archiveUrlIdentity" from old_rows union
				select "archiveUrlIdentity" from new_rows
			) affected order by "archiveUrlIdentity"
		loop
			delete from history_archive_evidence_root_summary where "archiveUrlIdentity"=affected_identity;
			insert into history_archive_evidence_root_summary (
				"archiveUrlIdentity","totalObjects","pendingObjects","activeObjects",
				"verifiedObjects","remoteFailureObjects","workerIssueObjects",
				"bucketObjects","verifiedBucketObjects","updatedAt","failureSummaryRevision"
			)
			select affected_identity,count(*)::bigint,
				count(*) filter(where status='pending')::bigint,
				count(*) filter(where status='scanning')::bigint,
				count(*) filter(where status='verified')::bigint,
				count(*) filter(where status='failed' and "failureChannel" in ('archive_evidence','archive_availability'))::bigint,
				count(*) filter(where status='failed' and "failureChannel"='scanner_issue')::bigint,
				count(*) filter(where "objectType"='bucket')::bigint,
				count(*) filter(where "objectType"='bucket' and status='verified')::bigint,
				now(),nextval('history_archive_failure_summary_revision_seq')
			from history_archive_object_queue where "archiveUrlIdentity"=affected_identity
			having count(*)>0;
		end loop;
		return null;
	end if;

	perform summary."archiveUrlIdentity"
	from history_archive_evidence_root_summary summary
	join (select "archiveUrlIdentity" from old_rows union
		select "archiveUrlIdentity" from new_rows) affected using("archiveUrlIdentity")
	order by summary."archiveUrlIdentity" for update of summary;
	with changed as materialized (${scalarUpdateChangesSql}), dirty_roots as (
		select distinct root.identity as "archiveUrlIdentity"
		from changed cross join lateral (values(changed.old_root),(changed.new_root)) root(identity)
		where root.identity is not null and (changed.failure_changed or changed.retained_changed)
	), raw_delta as (
		select "archiveUrlIdentity",sum(total_delta)::bigint as total_delta,
			sum(pending_delta)::bigint as pending_delta,sum(active_delta)::bigint as active_delta,
			sum(verified_delta)::bigint as verified_delta,sum(remote_delta)::bigint as remote_delta,
			sum(worker_delta)::bigint as worker_delta,sum(bucket_delta)::bigint as bucket_delta,
			sum(verified_bucket_delta)::bigint as verified_bucket_delta
		from (
			select "archiveUrlIdentity",1 as total_delta,
				coalesce((status='pending')::integer,0) as pending_delta,
				coalesce((status='scanning')::integer,0) as active_delta,
				coalesce((status='verified')::integer,0) as verified_delta,
				coalesce((status='failed' and "failureChannel" in ('archive_evidence','archive_availability'))::integer,0) as remote_delta,
				coalesce((status='failed' and "failureChannel"='scanner_issue')::integer,0) as worker_delta,
				coalesce(("objectType"='bucket')::integer,0) as bucket_delta,
				coalesce(("objectType"='bucket' and status='verified')::integer,0) as verified_bucket_delta
			from new_rows
			union all
			select "archiveUrlIdentity",-1,
				-coalesce((status='pending')::integer,0),-coalesce((status='scanning')::integer,0),
				-coalesce((status='verified')::integer,0),
				-coalesce((status='failed' and "failureChannel" in ('archive_evidence','archive_availability'))::integer,0),
				-coalesce((status='failed' and "failureChannel"='scanner_issue')::integer,0),
				-coalesce(("objectType"='bucket')::integer,0),
				-coalesce(("objectType"='bucket' and status='verified')::integer,0)
			from old_rows
		) changes group by "archiveUrlIdentity"
	), delta as materialized (
		select raw_delta.*,dirty_roots."archiveUrlIdentity" is not null as dirty
		from raw_delta left join dirty_roots using("archiveUrlIdentity")
		where total_delta<>0 or pending_delta<>0 or active_delta<>0 or verified_delta<>0
			or remote_delta<>0 or worker_delta<>0 or bucket_delta<>0 or verified_bucket_delta<>0
			or dirty_roots."archiveUrlIdentity" is not null
	), updated as (
		update history_archive_evidence_root_summary summary set
			"totalObjects"=summary."totalObjects"+delta.total_delta,
			"pendingObjects"=summary."pendingObjects"+delta.pending_delta,
			"activeObjects"=summary."activeObjects"+delta.active_delta,
			"verifiedObjects"=summary."verifiedObjects"+delta.verified_delta,
			"remoteFailureObjects"=summary."remoteFailureObjects"+delta.remote_delta,
			"workerIssueObjects"=summary."workerIssueObjects"+delta.worker_delta,
			"bucketObjects"=summary."bucketObjects"+delta.bucket_delta,
			"verifiedBucketObjects"=summary."verifiedBucketObjects"+delta.verified_bucket_delta,
			"failureSummaryRevision"=case when delta.dirty
				then nextval('history_archive_failure_summary_revision_seq') else summary."failureSummaryRevision" end,
			"updatedAt"=now()
		from delta where summary."archiveUrlIdentity"=delta."archiveUrlIdentity"
		returning summary."archiveUrlIdentity"
	)
	-- An unmatched ID may move into a previously empty root. Only insert missing
	-- positive roots; matched/existing roots receive their deltas exactly once above.
	insert into history_archive_evidence_root_summary (
		"archiveUrlIdentity","totalObjects","pendingObjects","activeObjects",
		"verifiedObjects","remoteFailureObjects","workerIssueObjects",
		"bucketObjects","verifiedBucketObjects","updatedAt","failureSummaryRevision"
	)
	select delta."archiveUrlIdentity",total_delta,pending_delta,active_delta,verified_delta,
		remote_delta,worker_delta,bucket_delta,verified_bucket_delta,now(),case when dirty
			then nextval('history_archive_failure_summary_revision_seq') else 0 end
	from delta where total_delta>0 and not exists (
		select 1 from history_archive_evidence_root_summary summary
		where summary."archiveUrlIdentity"=delta."archiveUrlIdentity")
	order by delta."archiveUrlIdentity"
	on conflict ("archiveUrlIdentity") do update set
		"totalObjects"=history_archive_evidence_root_summary."totalObjects"+excluded."totalObjects",
		"pendingObjects"=history_archive_evidence_root_summary."pendingObjects"+excluded."pendingObjects",
		"activeObjects"=history_archive_evidence_root_summary."activeObjects"+excluded."activeObjects",
		"verifiedObjects"=history_archive_evidence_root_summary."verifiedObjects"+excluded."verifiedObjects",
		"remoteFailureObjects"=history_archive_evidence_root_summary."remoteFailureObjects"+excluded."remoteFailureObjects",
		"workerIssueObjects"=history_archive_evidence_root_summary."workerIssueObjects"+excluded."workerIssueObjects",
		"bucketObjects"=history_archive_evidence_root_summary."bucketObjects"+excluded."bucketObjects",
		"verifiedBucketObjects"=history_archive_evidence_root_summary."verifiedBucketObjects"+excluded."verifiedBucketObjects",
		"failureSummaryRevision"=case when excluded."failureSummaryRevision"<>0
			then excluded."failureSummaryRevision" else history_archive_evidence_root_summary."failureSummaryRevision" end,
		"updatedAt"=now();
	update history_archive_evidence_root_summary summary
	set "failureSummaryRevision"=nextval('history_archive_failure_summary_revision_seq')
	where summary."failureSummaryRevision"=0 and summary."archiveUrlIdentity" in
		(select "archiveUrlIdentity" from new_rows);
	delete from history_archive_evidence_root_summary summary where summary."totalObjects"=0
		and summary."archiveUrlIdentity" in (select "archiveUrlIdentity" from old_rows);
	return null;
end;
$statement$;
`;
