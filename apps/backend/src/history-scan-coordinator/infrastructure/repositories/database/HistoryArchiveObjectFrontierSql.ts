import { historyArchiveObjectOpenSequentialCohortSql } from './HistoryArchiveSequentialChainSql.js';

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
const openSequentialCohortSql =
	historyArchiveObjectOpenSequentialCohortSql('candidate');

export const historyArchiveObjectFrontierSql = `
	with roots as materialized (
		select root.id, root."archiveUrlIdentity", root."lastClaimedAt"
		from "history_archive_object_queue" root
		where root."objectType" = 'history-archive-state'
			and root."objectKey" = 'root'
			and not exists (
				select 1
				from "history_archive_object_host_throttle" throttle
				where throttle."hostIdentity" = root."hostIdentity"
					and throttle."blockedUntil" > now()
			)
	), root_capacity as materialized (
		select roots.*, greatest(
			$2::integer - runnable.count, 0
		) as capacity
		from roots
		cross join lateral (
			select count(*)::integer as count
			from (
				select 1
				from (
					(
						select 1
						from "history_archive_object_queue" active
						where active."archiveUrlIdentity" =
							roots."archiveUrlIdentity"
							and active.status = 'scanning'
						limit $2
					)
					union all
					(
						select 1
						from "history_archive_object_queue" active
						where active."archiveUrlIdentity" =
							roots."archiveUrlIdentity"
							and active.status = 'pending'
							and active."executionDisposition" = 'executable'
							and active."dependencyReady" = true
							and (
								active."transitionEffectsRequiredAt" is null
								or active."transitionEffectsCompletedAt" is not null
							)
						limit $2
					)
				) runnable_candidates
				limit $2
			) bounded_runnable
		) runnable
	), root_attempts as materialized (
		select root.*
		from root_capacity root
		where root.capacity > 0
		order by root."lastClaimedAt" asc nulls first, root.id
		limit greatest($1::integer, 1)
	), probes as materialized (
		select
			root.id as root_id,
			root."lastClaimedAt" as root_last_claimed_at,
			root.capacity,
			cursor."objectType",
			candidate.id,
			candidate."objectKey",
			case
				when candidate.id is null then false
				else ${dependencyReadySql}
			end as dependency_ready,
			case cursor."objectType"
				when 'history-archive-state' then 0
				when 'checkpoint-state' then 1
				when 'bucket' then 2
				when 'ledger' then 3
				when 'transactions' then 4
				when 'results' then 5
				else 6
			end as type_order
		from root_attempts root
		cross join lateral (
			select cursor.*
			from "history_archive_object_frontier_cursor" cursor
			where cursor."archiveUrlIdentity" = root."archiveUrlIdentity"
		) cursor
		left join lateral (
			select candidate.id, candidate."archiveUrlIdentity",
				candidate."objectType", candidate."objectKey",
				candidate."checkpointLedger", candidate."bucketHash"
			from "history_archive_object_queue" candidate
			where cursor."objectKey" is null
				and candidate."archiveUrlIdentity" = cursor."archiveUrlIdentity"
				and candidate."objectType" = cursor."objectType"
                                and ${openSequentialCohortSql}
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
		) initial_candidate on true
		left join lateral (
			select candidate.id, candidate."archiveUrlIdentity",
				candidate."objectType", candidate."objectKey",
				candidate."checkpointLedger", candidate."bucketHash"
			from "history_archive_object_queue" candidate
			where cursor."objectKey" is not null
				and candidate."archiveUrlIdentity" = cursor."archiveUrlIdentity"
				and candidate."objectType" = cursor."objectType"
                                and ${openSequentialCohortSql}
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
		) continued_candidate on true
		left join lateral (
			select candidate.id, candidate."archiveUrlIdentity",
				candidate."objectType", candidate."objectKey",
				candidate."checkpointLedger", candidate."bucketHash"
			from "history_archive_object_queue" candidate
			where cursor."objectKey" is not null
				and initial_candidate.id is null
				and continued_candidate.id is null
				and candidate."archiveUrlIdentity" = cursor."archiveUrlIdentity"
				and candidate."objectType" = cursor."objectType"
                                and ${openSequentialCohortSql}
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
		) wrapped_candidate on true
		cross join lateral (
			select
				coalesce(
					initial_candidate.id,
					continued_candidate.id,
					wrapped_candidate.id
				) as id,
				coalesce(
					initial_candidate."archiveUrlIdentity",
					continued_candidate."archiveUrlIdentity",
					wrapped_candidate."archiveUrlIdentity"
				) as "archiveUrlIdentity",
				coalesce(
					initial_candidate."objectType",
					continued_candidate."objectType",
					wrapped_candidate."objectType"
				) as "objectType",
				coalesce(
					initial_candidate."objectKey",
					continued_candidate."objectKey",
					wrapped_candidate."objectKey"
				) as "objectKey",
				coalesce(
					initial_candidate."checkpointLedger",
					continued_candidate."checkpointLedger",
					wrapped_candidate."checkpointLedger"
				) as "checkpointLedger",
				coalesce(
					initial_candidate."bucketHash",
					continued_candidate."bucketHash",
					wrapped_candidate."bucketHash"
				) as "bucketHash"
		) candidate
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
			and probes.id is not null
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
			from "history_archive_checkpoint_bucket_dependency_current" dependency
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
