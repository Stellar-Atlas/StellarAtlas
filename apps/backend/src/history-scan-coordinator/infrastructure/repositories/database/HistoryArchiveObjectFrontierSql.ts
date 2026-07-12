export const seedHistoryArchiveFrontierCursorsSql = `
	insert into "history_archive_object_frontier_cursor" (
		"archiveUrlIdentity", "objectType"
	)
	select root."archiveUrlIdentity", object_type.value
	from "history_archive_object_queue" root
	cross join (
		values
			('history-archive-state'),
			('checkpoint-state'),
			('bucket'),
			('ledger'),
			('transactions'),
			('results'),
			('scp')
	) object_type(value)
	where root."objectType" = 'history-archive-state'
		and root."objectKey" = 'root'
	on conflict ("archiveUrlIdentity", "objectType") do nothing
`;

const dependencyReadySql = dependencyEligibilitySql('candidate');

export const historyArchiveObjectFrontierSql = `
	with roots as materialized (
		select root.id, root."archiveUrlIdentity", root."lastClaimedAt"
		from "history_archive_object_queue" root
		where root."objectType" = 'history-archive-state'
			and root."objectKey" = 'root'
	), root_capacity as materialized (
		select roots.*, greatest(
			$2::integer - (
				select count(*)::integer
				from "history_archive_object_queue" active
				where active."archiveUrlIdentity" = roots."archiveUrlIdentity"
					and (
						active.status = 'scanning'
						or (
							active."executionDisposition" = 'executable'
							and active."dependencyReady" = true
							and (
								active.status = 'pending'
								or (
									active.status = 'failed'
									and coalesce(
										active."nextAttemptAt",
										active."updatedAt" + interval '1 hour'
									) <= now()
								)
							)
						)
					)
			), 0
		) as capacity
		from roots
	), probes as materialized (
		select
			root.id as root_id,
			root."lastClaimedAt" as root_last_claimed_at,
			root.capacity,
			cursor."objectType",
			candidate.id,
			candidate."objectKey",
			${dependencyReadySql} as dependency_ready,
			case cursor."objectType"
				when 'history-archive-state' then 0
				when 'checkpoint-state' then 1
				when 'bucket' then 2
				when 'ledger' then 3
				when 'transactions' then 4
				when 'results' then 5
				else 6
			end as type_order
		from root_capacity root
		join "history_archive_object_frontier_cursor" cursor
			on cursor."archiveUrlIdentity" = root."archiveUrlIdentity"
		join lateral (
			select sought.*
			from (
				(
					select candidate.id, candidate."archiveUrlIdentity",
						candidate."objectType", candidate."objectKey",
						candidate."checkpointLedger", candidate."bucketHash", 0 as phase
					from "history_archive_object_queue" candidate
					where cursor."objectKey" is null
						and candidate."archiveUrlIdentity" =
							cursor."archiveUrlIdentity"
						and candidate."objectType" = cursor."objectType"
						and candidate.status = 'pending'
						and (
							candidate."executionDisposition" is null
							or candidate."executionDisposition" = 'deferred'
						)
						and (
							candidate."executionReason" is null
							or candidate."executionReason" not in (
								'canonical-frontier-waiting',
								'proof-completion-waiting'
							)
						)
					order by candidate."objectKey" desc
					limit 1
				)
				union all
				(
					select candidate.id, candidate."archiveUrlIdentity",
						candidate."objectType", candidate."objectKey",
						candidate."checkpointLedger", candidate."bucketHash", 0 as phase
					from "history_archive_object_queue" candidate
					where cursor."objectKey" is not null
						and candidate."archiveUrlIdentity" =
							cursor."archiveUrlIdentity"
						and candidate."objectType" = cursor."objectType"
						and candidate.status = 'pending'
						and (
							candidate."executionDisposition" is null
							or candidate."executionDisposition" = 'deferred'
						)
						and (
							candidate."executionReason" is null
							or candidate."executionReason" not in (
								'canonical-frontier-waiting',
								'proof-completion-waiting'
							)
						)
						and candidate."objectKey" < cursor."objectKey"
					order by candidate."objectKey" desc
					limit 1
				)
				union all
				(
					select candidate.id, candidate."archiveUrlIdentity",
						candidate."objectType", candidate."objectKey",
						candidate."checkpointLedger", candidate."bucketHash", 1 as phase
					from "history_archive_object_queue" candidate
					where cursor."objectKey" is not null
						and candidate."archiveUrlIdentity" =
							cursor."archiveUrlIdentity"
						and candidate."objectType" = cursor."objectType"
						and candidate.status = 'pending'
						and (
							candidate."executionDisposition" is null
							or candidate."executionDisposition" = 'deferred'
						)
						and (
							candidate."executionReason" is null
							or candidate."executionReason" not in (
								'canonical-frontier-waiting',
								'proof-completion-waiting'
							)
						)
					order by candidate."objectKey" desc
					limit 1
				)
			) sought
			order by sought.phase
			limit 1
		) candidate on true
	), eligible as materialized (
		select probes.*, row_number() over (
			partition by root_id order by type_order, "objectKey", id
		) as root_rank
		from probes
		where dependency_ready
	), selected as materialized (
		select id
		from eligible
		where root_rank <= capacity
		order by
			root_rank,
			root_last_claimed_at asc nulls first,
			root_id,
			type_order,
			id
		limit $1
	), queue_updates as (
		update "history_archive_object_queue" object
		set "dependencyReady" = probes.dependency_ready,
			"executionDisposition" = case
				when selected.id is not null then 'executable'
				else object."executionDisposition"
			end,
			"executionReason" = case
				when selected.id is not null then 'frontier-admitted'
				else object."executionReason"
			end,
			"executionDispositionAt" = case
				when selected.id is not null then now()
				else object."executionDispositionAt"
			end,
			"updatedAt" = now()
		from probes
		left join selected on selected.id = probes.id
		where object.id = probes.id
			and (
				object."dependencyReady" is distinct from probes.dependency_ready
				or selected.id is not null
			)
		returning object.id
	), cursor_updates as (
		update "history_archive_object_frontier_cursor" cursor
		set "objectKey" = probes."objectKey", "updatedAt" = now()
		from probes
		where cursor."archiveUrlIdentity" = (
			select root."archiveUrlIdentity"
			from roots root where root.id = probes.root_id
		)
			and cursor."objectType" = probes."objectType"
		returning cursor."archiveUrlIdentity"
	)
	select
		(select count(*)::integer from selected) as "admittedObjects",
		(select count(*)::integer from cursor_updates) as "cursorAdvances"
`;

function dependencyEligibilitySql(alias: string): string {
	return `case
		when ${alias}."objectType" = 'history-archive-state' then true
		when ${alias}."objectType" = 'checkpoint-state' then exists (
			select 1 from "history_archive_object_queue" dependency
			where dependency."archiveUrlIdentity" = ${alias}."archiveUrlIdentity"
				and dependency."objectType" = 'history-archive-state'
				and dependency."objectKey" = 'root'
				and dependency.status = 'verified'
		)
		when ${alias}."objectType" in ('ledger', 'transactions', 'results', 'scp')
			then exists (
				select 1 from "history_archive_object_queue" dependency
				where dependency."archiveUrlIdentity" = ${alias}."archiveUrlIdentity"
					and dependency."objectType" = 'checkpoint-state'
					and dependency."checkpointLedger" = ${alias}."checkpointLedger"
					and dependency.status = 'verified'
			)
		else exists (
			select 1
			from "history_archive_checkpoint_bucket_dependency" dependency
			join "history_archive_object_queue" checkpoint
				on checkpoint."archiveUrlIdentity" = dependency."archiveUrlIdentity"
				and checkpoint."checkpointLedger" = dependency."checkpointLedger"
				and checkpoint."objectType" = 'checkpoint-state'
				and checkpoint.status = 'verified'
			where dependency."archiveUrlIdentity" = ${alias}."archiveUrlIdentity"
				and dependency."bucketHash" = ${alias}."bucketHash"
		)
	end`;
}
