/** Sparse source findings, not job history. Only fenced same-source work resolves them. */
export const historyArchiveRetainedRemoteFindingSql = `
	create table history_archive_retained_remote_finding (
		"objectRemoteId" uuid primary key,
		"archiveUrlIdentity" text not null,
		"objectType" text not null,
		"objectCreatedAt" timestamptz not null,
		"observedAt" timestamptz not null,
		"failureChannel" text not null check (
			"failureChannel" in ('archive_evidence', 'archive_availability')
		),
		"errorType" text,
		"errorMessage" text,
		"httpStatus" integer,
		"retainedOnly" boolean not null
	);
	create index history_archive_retained_remote_root_page
		on history_archive_retained_remote_finding
		("archiveUrlIdentity", "objectCreatedAt" desc, "objectRemoteId" desc)
		where "retainedOnly";
	create index history_archive_retained_remote_type_page
		on history_archive_retained_remote_finding
		("archiveUrlIdentity", "objectType", "objectCreatedAt" desc, "objectRemoteId" desc)
		where "retainedOnly";
	create table history_archive_retained_remote_summary (
		"archiveUrlIdentity" text not null,
		"objectType" text not null,
		"retainedObjects" bigint not null check ("retainedObjects" >= 0),
		primary key ("archiveUrlIdentity", "objectType")
	);

	-- One grouped delta per source/type per statement, locked in canonical order.
	create function apply_history_archive_retained_remote_deltas(deltas jsonb)
	returns void language plpgsql as $$
	begin
		if deltas is null then return; end if;
		insert into history_archive_retained_remote_summary
			("archiveUrlIdentity", "objectType", "retainedObjects")
		select root, kind, 0 from jsonb_to_recordset(deltas)
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
		set "retainedObjects" = summary."retainedObjects" + d.delta
		from jsonb_to_recordset(deltas) as d(root text, kind text, delta bigint)
		where summary."archiveUrlIdentity" = d.root and summary."objectType" = d.kind;
	end
	$$;

	create function retain_history_archive_remote_findings()
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
			-- Current remote failures already have an indexed queue representation.
			-- Refresh only an existing retained record when a newer failure arrives.
			select (new_row)."remoteId", (new_row)."archiveUrlIdentity",
				(new_row)."objectType", (new_row)."createdAt", (new_row)."updatedAt",
				(new_row)."failureChannel", (new_row)."errorType",
				(new_row)."errorMessage", (new_row)."httpStatus", false as retained
			from changed_objects
			where (new_row).status = 'failed'
				and (new_row)."failureChannel" in ('archive_evidence', 'archive_availability')
				and exists (select 1 from history_archive_retained_remote_finding finding
					where finding."objectRemoteId" = (new_row)."remoteId")
			union all
			-- A direct successful terminal does not need a capture/delete round trip.
			select (old_row)."remoteId", (old_row)."archiveUrlIdentity",
				(old_row)."objectType", (old_row)."createdAt", (old_row)."updatedAt",
				(old_row)."failureChannel", (old_row)."errorType",
				(old_row)."errorMessage", (old_row)."httpStatus", true as retained
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
		select jsonb_agg(jsonb_build_object('root', root, 'kind', kind, 'delta', delta))
			into deltas from grouped where delta <> 0;
		perform apply_history_archive_retained_remote_deltas(deltas);
		return null;
	end
	$$;
	create trigger history_archive_retain_remote_transition
	after update on history_archive_object_queue
	referencing old table as old_objects new table as new_objects
	for each statement execute function retain_history_archive_remote_findings();
	-- Rolling deploy: activate only after all old completion writers are drained.
	alter table history_archive_object_queue disable trigger history_archive_retain_remote_transition;
`;

/** IDs must come from the completion statement's fenced RETURNING set, in the same transaction. */
export const resolveVerifiedRemoteFindingsSql = `
	with resolved as (
		delete from history_archive_retained_remote_finding finding
		using unnest($1::uuid[]) verified("remoteId")
		where finding."objectRemoteId" = verified."remoteId"
		returning finding."archiveUrlIdentity", finding."objectType", finding."retainedOnly"
	), grouped as (
		select "archiveUrlIdentity" as root, "objectType" as kind, -count(*) as delta
		from resolved where "retainedOnly" group by "archiveUrlIdentity", "objectType"
	), deltas as (
		select jsonb_agg(jsonb_build_object('root', root, 'kind', kind, 'delta', delta)) as value
		from grouped
	)
	select apply_history_archive_retained_remote_deltas(value) from deltas where value is not null
`;
