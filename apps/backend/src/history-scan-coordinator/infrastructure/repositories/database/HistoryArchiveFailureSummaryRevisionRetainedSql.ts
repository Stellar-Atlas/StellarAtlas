// Versioned replacements; historical migration helper remains unchanged.
// Preimage: HistoryArchiveRetainedRemoteFindingSql.ts
// SHA256: 91c5946cb2bedbd8d70c97c98a74ab109971e07799c5c25c52e77a7734c3e606
// Replaces functions only: does not recreate or enable the retained transition trigger.
export const archiveRetainedRemoteRevisionFunctionsSql = `
	create or replace function apply_history_archive_retained_remote_deltas(deltas jsonb)
	returns void language plpgsql as $$
	begin
		if deltas is null then return; end if;
		insert into history_archive_retained_remote_summary
			("archiveUrlIdentity", "objectType", "retainedObjects", "failureSummaryRevision")
		select root, kind, 0, 0 from jsonb_to_recordset(deltas)
			as d(root text, kind text, delta bigint)
		order by root, kind
		on conflict do nothing;
		perform summary."archiveUrlIdentity"
		from history_archive_retained_remote_summary summary
		join jsonb_to_recordset(deltas) as d(root text, kind text, delta bigint)
			on summary."archiveUrlIdentity" = d.root and summary."objectType" = d.kind
		order by summary."archiveUrlIdentity", summary."objectType"
		for update of summary;
		update history_archive_retained_remote_summary summary
		set "retainedObjects" = summary."retainedObjects" + d.delta,
			"failureSummaryRevision" = nextval('history_archive_failure_summary_revision_seq')
		from jsonb_to_recordset(deltas) as d(root text, kind text, delta bigint)
		where summary."archiveUrlIdentity" = d.root and summary."objectType" = d.kind;
	end
	$$;

	create or replace function retain_history_archive_remote_findings()
	returns trigger language plpgsql as $$
	declare deltas jsonb;
	begin
		with changed_objects as materialized (
			select old_object."remoteId",
				old_object."archiveUrlIdentity" as old_root, new_object."archiveUrlIdentity" as new_root,
				old_object."objectType" as old_type, new_object."objectType" as new_type,
				old_object."createdAt" as old_created, new_object."createdAt" as new_created,
				old_object."updatedAt" as old_updated, new_object."updatedAt" as new_updated,
				old_object.status as old_status, new_object.status as new_status,
				old_object."failureChannel" as old_channel, new_object."failureChannel" as new_channel,
				old_object."errorType" as old_error_type, new_object."errorType" as new_error_type,
				old_object."errorMessage" as old_error_message, new_object."errorMessage" as new_error_message,
				old_object."httpStatus" as old_http_status, new_object."httpStatus" as new_http_status
			from old_objects old_object
			join new_objects new_object using ("remoteId")
			where row(old_object.status, old_object."failureChannel",
					old_object."errorType", old_object."errorMessage", old_object."httpStatus")
				is distinct from row(new_object.status, new_object."failureChannel",
					new_object."errorType", new_object."errorMessage", new_object."httpStatus")
				and (old_object.status = 'failed' or new_object.status = 'failed')
		), candidates as (
			-- Preserve the original sparse current/retained membership rules.
			select "remoteId", new_root as "archiveUrlIdentity", new_type as "objectType",
				new_created as "createdAt", new_updated as "updatedAt", new_channel as "failureChannel",
				new_error_type as "errorType", new_error_message as "errorMessage",
				new_http_status as "httpStatus", false as retained
			from changed_objects
			where new_status = 'failed'
				and new_channel in ('archive_evidence', 'archive_availability')
				and exists (select 1 from history_archive_retained_remote_finding finding
					where finding."objectRemoteId" = changed_objects."remoteId")
			union all
			select "remoteId", old_root, old_type, old_created, old_updated, old_channel,
				old_error_type, old_error_message, old_http_status, true as retained
			from changed_objects
			where old_status = 'failed'
				and old_channel in ('archive_evidence', 'archive_availability')
				and new_status <> 'verified'
				and not (new_status = 'failed' and
					coalesce(new_channel in ('archive_evidence', 'archive_availability'), false))
		), previous as materialized (
			select candidate.*, coalesce(finding."retainedOnly", false) as was_retained
			from candidates candidate
			left join history_archive_retained_remote_finding finding
				on finding."objectRemoteId" = candidate."remoteId"
		), written as (
			insert into history_archive_retained_remote_finding (
				"objectRemoteId", "archiveUrlIdentity", "objectType", "objectCreatedAt",
				"observedAt", "failureChannel", "errorType", "errorMessage", "httpStatus", "retainedOnly"
			)
			select "remoteId", "archiveUrlIdentity", "objectType", "createdAt", "updatedAt",
				"failureChannel", "errorType", "errorMessage", "httpStatus", retained
			from previous order by "remoteId"
			on conflict ("objectRemoteId") do update set
				"observedAt" = excluded."observedAt",
				"failureChannel" = excluded."failureChannel",
				"errorType" = excluded."errorType", "errorMessage" = excluded."errorMessage",
				"httpStatus" = excluded."httpStatus", "retainedOnly" = excluded."retainedOnly"
			returning "objectRemoteId"
		), grouped as (
			select previous."archiveUrlIdentity" as root, previous."objectType" as kind,
				sum(retained::integer - was_retained::integer) as delta
			from previous join written on written."objectRemoteId" = previous."remoteId"
			group by previous."archiveUrlIdentity", previous."objectType"
		)
		-- Count-neutral changed groups must still advance their revision.
		select jsonb_agg(jsonb_build_object('root', root, 'kind', kind, 'delta', delta))
			into deltas from grouped;
		perform apply_history_archive_retained_remote_deltas(deltas);
		return null;
	end
	$$;
`;
