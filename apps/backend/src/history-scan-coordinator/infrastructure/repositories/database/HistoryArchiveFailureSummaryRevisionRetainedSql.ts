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
			select old_object as old_row, new_object as new_row
			from old_objects old_object
			join new_objects new_object using ("remoteId")
			where row(old_object.status, old_object."failureChannel",
					old_object."errorType", old_object."errorMessage", old_object."httpStatus")
				is distinct from row(new_object.status, new_object."failureChannel",
					new_object."errorType", new_object."errorMessage", new_object."httpStatus")
				and (old_object.status = 'failed' or new_object.status = 'failed')
		), candidates as (
			-- Preserve the original sparse current/retained membership rules.
			select (new_row)."remoteId", (new_row)."archiveUrlIdentity",
				(new_row)."objectType", (new_row)."createdAt", (new_row)."updatedAt",
				(new_row)."failureChannel", (new_row)."errorType", (new_row)."errorMessage",
				(new_row)."httpStatus", false as retained
			from changed_objects
			where (new_row).status = 'failed'
				and (new_row)."failureChannel" in ('archive_evidence', 'archive_availability')
				and exists (select 1 from history_archive_retained_remote_finding finding
					where finding."objectRemoteId" = (new_row)."remoteId")
			union all
			select (old_row)."remoteId", (old_row)."archiveUrlIdentity",
				(old_row)."objectType", (old_row)."createdAt", (old_row)."updatedAt",
				(old_row)."failureChannel", (old_row)."errorType", (old_row)."errorMessage",
				(old_row)."httpStatus", true as retained
			from changed_objects
			where (old_row).status = 'failed'
				and (old_row)."failureChannel" in ('archive_evidence', 'archive_availability')
				and (new_row).status <> 'verified'
				and not ((new_row).status = 'failed' and
					coalesce((new_row)."failureChannel" in ('archive_evidence', 'archive_availability'), false))
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
