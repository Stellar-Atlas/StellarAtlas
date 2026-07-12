import { historyArchiveObjectDependencySatisfiedSql } from './HistoryArchiveObjectDependencySql.js';

const candidateDependencyReadySql =
	historyArchiveObjectDependencySatisfiedSql('candidate');
const claimGateKeySql =
	"hashtextextended('history_archive_object_claim_gate', 104729)";
const transitionReadySql = `(
	candidate."transitionEffectsRequiredAt" is null
	or candidate."transitionEffectsCompletedAt" is not null
)`;
const pendingReadySql = `candidate.status = 'pending'
	and (
		candidate."nextAttemptAt" is null
		or candidate."nextAttemptAt" <= now()
	)`;
const failedReadySql = `candidate.status = 'failed'
	and coalesce(
		candidate."nextAttemptAt",
		candidate."updatedAt" + interval '1 hour'
	) <= now()`;

export const historyArchiveObjectClaimFallbackLockSql = `
	select pg_advisory_xact_lock(${claimGateKeySql})
`;

export const historyArchiveObjectClaimCleanupSql = `
	with claim_gate as materialized (
		select case
			when $1::boolean then true
			else pg_try_advisory_xact_lock_shared(${claimGateKeySql})
		end as locked
	), cleaned_slots as (
		update "history_archive_object_claim_slot" slot
		set "objectRemoteId" = null,
			"claimedAt" = null,
			"updatedAt" = now()
		from claim_gate
		where claim_gate.locked
			and slot."objectRemoteId" is not null
			and not exists (
				select 1
				from "history_archive_object_queue" active
				where active."remoteId" = slot."objectRemoteId"
					and active.status = 'scanning'
			)
		returning slot.slot
	)
	select
		claim_gate.locked,
		(select count(*)::integer from cleaned_slots) as "cleanedSlots"
	from claim_gate
`;

export const historyArchiveObjectClaimAdoptionSql = `
	with adoption_state as materialized (
		select exists (
			select 1
			from "history_archive_object_queue" active
			where active.status = 'scanning'
				and not exists (
					select 1
					from "history_archive_object_claim_slot" occupied
					where occupied."objectRemoteId" = active."remoteId"
				)
		) as needed
	), adoption_guard as materialized (
		select case
			when adoption_state.needed then pg_try_advisory_xact_lock(
				hashtext('history_archive_claim_slot_adoption')
			)
			else true
		end as locked
		from adoption_state
	), untracked_active as materialized (
		select
			active."remoteId",
			row_number() over (
				order by active."claimedAt" nulls first, active.id
			) as position
		from "history_archive_object_queue" active
		cross join adoption_guard
		where active.status = 'scanning'
			and adoption_guard.locked
			and not exists (
				select 1
				from "history_archive_object_claim_slot" occupied
				where occupied."objectRemoteId" = active."remoteId"
			)
		order by active."claimedAt" nulls first, active.id
		limit $1
	), available_slots as materialized (
		select slot.slot
		from "history_archive_object_claim_slot" slot
		cross join adoption_state
		cross join adoption_guard
		where slot."objectRemoteId" is null
			and slot.slot < $1
			and adoption_state.needed
			and adoption_guard.locked
		order by slot.slot
		for update of slot skip locked
		limit $1
	), adoption_slots as materialized (
		select
			available_slots.slot,
			row_number() over (order by available_slots.slot) as position
		from available_slots
	), adopted_slots as (
		update "history_archive_object_claim_slot" slot
		set "objectRemoteId" = untracked_active."remoteId",
			"claimedAt" = now(),
			"updatedAt" = now()
		from untracked_active
		join adoption_slots
			on adoption_slots.position = untracked_active.position
		where slot.slot = adoption_slots.slot
		returning slot.slot
	)
	select
		adoption_guard.locked,
		(select count(*)::integer from untracked_active) as "untrackedObjects",
		(select count(*)::integer from adopted_slots) as "adoptedObjects"
	from adoption_guard
`;

export const historyArchiveObjectClaimSelectionSql = `
	with free_slots as materialized (
		select slot.slot
		from "history_archive_object_claim_slot" slot
		where slot."objectRemoteId" is null
			and slot.slot < $3
		order by slot.slot
	), root_work as materialized (
		select
			candidate."archiveUrlIdentity",
			bool_or(candidate.status = 'pending') as "hasPending",
			bool_or(candidate.status = 'failed') as "hasFailed",
			min(case candidate."executionReason"
				when 'canonical-frontier-reserve' then 0
				when 'proof-completion-reserve' then 1
				else 2
			end)::integer as priority
		from "history_archive_object_queue" candidate
		cross join (select 1 from free_slots limit 1) capacity
		where (${pendingReadySql} or ${failedReadySql})
			and ${transitionReadySql}
			and candidate."executionDisposition" = 'executable'
			and ${candidateDependencyReadySql}
			and candidate."objectType" = any($1)
		group by candidate."archiveUrlIdentity"
	), root_pool as materialized (
		select
			root.id,
			root."archiveUrlIdentity",
			root."hostIdentity",
			root."lastClaimedAt",
			root_work."hasPending",
			root_work."hasFailed",
			root_work.priority
		from "history_archive_object_queue" root
		join root_work
			on root_work."archiveUrlIdentity" = root."archiveUrlIdentity"
		where root."objectType" = 'history-archive-state'
			and root."objectKey" = 'root'
			and (
				select count(*)
				from "history_archive_object_queue" active
				where active."archiveUrlIdentity" = root."archiveUrlIdentity"
					and active.status = 'scanning'
			) < $2
			and (
				select count(*)
				from "history_archive_object_queue" active
				where active."hostIdentity" = root."hostIdentity"
					and active.status = 'scanning'
			) < $4
			and not exists (
				select 1
				from "history_archive_object_host_throttle" throttle
				where throttle."hostIdentity" = root."hostIdentity"
					and throttle."blockedUntil" > now()
			)
	), class_state as materialized (
		select
			exists (
				select 1 from root_pool where root_pool."hasPending"
			) as "hasPending",
			exists (
				select 1 from root_pool where root_pool."hasFailed"
			) as "hasFailed"
	), slot_pool as materialized (
		select
			free_slots.slot
		from free_slots
		cross join class_state
		where class_state."hasPending"
			or (free_slots.slot % 2 = 0 and class_state."hasFailed")
	), slot_pool_state as materialized (
		select exists (select 1 from slot_pool) as available
	), claim_slot as materialized (
		select slot.slot
		from "history_archive_object_claim_slot" slot
		join slot_pool on slot_pool.slot = slot.slot
		where slot."objectRemoteId" is null
		order by slot.slot
		for update of slot skip locked
		limit 1
	), root_choice_pool as materialized (
		select
			root_pool.*,
			case
				when claim_slot.slot % 2 = 1 then 'pending'
				when root_pool."hasFailed" and (
					claim_slot.slot % 4 = 0 or not root_pool."hasPending"
				)
					then 'failed'
				else 'pending'
			end as "claimClass",
			case
				when claim_slot.slot % 4 = 0 and root_pool."hasFailed" then 0
				when claim_slot.slot % 4 = 0 then 1
				when root_pool."hasPending" then 0
				else 1
			end as "claimClassPriority"
		from root_pool
		cross join claim_slot
		cross join class_state
		where (claim_slot.slot % 2 = 1 and root_pool."hasPending")
			or (
				claim_slot.slot % 2 = 0
				and class_state."hasFailed"
				and root_pool."hasFailed"
			)
			or (
				claim_slot.slot % 2 = 0
				and not class_state."hasFailed"
				and root_pool."hasPending"
			)
	), root_choice_state as materialized (
		select exists (select 1 from root_choice_pool) as available
	), claim_root as materialized (
		select root_choice_pool.*
		from root_choice_pool
		join "history_archive_object_queue" root on root.id = root_choice_pool.id
		order by
			root_choice_pool."claimClassPriority",
			root_choice_pool.priority,
			root_choice_pool."lastClaimedAt" asc nulls first,
			root_choice_pool.id
		for update of root skip locked
		limit 1
	), host_lock as materialized (
		select
			claim_root.*,
			claim_slot.slot,
			pg_try_advisory_xact_lock(
				hashtextextended(claim_root."hostIdentity", 104729)
			) as locked
		from claim_root
		cross join claim_slot
	)
	select
		case
			when claim_slot.slot is null and slot_pool_state.available then 'contended'
			when claim_slot.slot is null then 'idle'
			when host_lock.id is null and root_choice_state.available then 'contended'
			when host_lock.id is null then 'contended'
			when not host_lock.locked then 'contended'
			else 'selected'
		end as outcome,
		host_lock.slot as slot,
		host_lock.id as "rootId",
		host_lock."archiveUrlIdentity" as "archiveUrlIdentity",
		host_lock."hostIdentity" as "hostIdentity",
		host_lock."claimClass" as "claimClass"
	from slot_pool_state
	left join claim_slot on true
	left join root_choice_state on true
	left join host_lock on true
`;

export const historyArchiveObjectClaimFinalizeSql = `
	with selected_slot as materialized (
		select slot.slot
		from "history_archive_object_claim_slot" slot
		where slot.slot = $3 and slot."objectRemoteId" is null
	), selected_root as materialized (
		select root.id, root."archiveUrlIdentity", root."hostIdentity"
		from "history_archive_object_queue" root
		cross join selected_slot
		where root.id = $5
			and root."archiveUrlIdentity" = $6
			and root."hostIdentity" = $7
			and root."objectType" = 'history-archive-state'
			and root."objectKey" = 'root'
			and (
				select count(*)
				from "history_archive_object_queue" active
				where active."archiveUrlIdentity" = root."archiveUrlIdentity"
					and active.status = 'scanning'
			) < $2
			and (
				select count(*)
				from "history_archive_object_queue" active
				where active."hostIdentity" = root."hostIdentity"
					and active.status = 'scanning'
			) < $4
			and not exists (
				select 1
				from "history_archive_object_host_throttle" throttle
				where throttle."hostIdentity" = root."hostIdentity"
					and throttle."blockedUntil" > now()
			)
	), selected_candidate as materialized (
		select candidate.id
		from "history_archive_object_queue" candidate
		join selected_root root
			on root."archiveUrlIdentity" = candidate."archiveUrlIdentity"
		where (
				($8::text = 'pending' and ${pendingReadySql})
				or (
					$8::text = 'failed'
					and $3::integer % 2 = 0
					and ${failedReadySql}
				)
			)
			and ${transitionReadySql}
			and candidate."executionDisposition" = 'executable'
			and ${candidateDependencyReadySql}
			and candidate."objectType" = any($1)
		order by
			case candidate."executionReason"
				when 'canonical-frontier-reserve' then 0
				when 'proof-completion-reserve' then 1
				else 2
			end,
			case when candidate.status = 'failed' then coalesce(
				candidate."nextAttemptAt",
				candidate."updatedAt" + interval '1 hour'
			) end asc nulls last,
			candidate."lastClaimedAt" asc nulls first,
			candidate."objectOrder",
			case when candidate.status = 'pending'
				then candidate."checkpointLedger" end desc nulls last,
			candidate."objectKey",
			candidate.id
		for update of candidate skip locked
		limit 1
	), claimed as (
		update "history_archive_object_queue" candidate
		set status = 'scanning',
			"claimedAt" = now(),
			"lastClaimedAt" = now(),
			attempts = candidate.attempts + 1,
			"bytesDownloaded" = null,
			"workerStage" = 'claimed',
			"errorType" = null,
			"errorMessage" = null,
			"httpStatus" = null,
			"nextAttemptAt" = null,
			"verificationFacts" = null,
			"completionArchiveMetadata" = null,
			"transitionEffectsCompletedAt" = null,
			"transitionEffectsRequiredAt" = null,
			"updatedAt" = now()
		from selected_candidate
		where candidate.id = selected_candidate.id
		returning candidate.*
	), occupied_slot as (
		update "history_archive_object_claim_slot" slot
		set "objectRemoteId" = claimed."remoteId",
			"claimedAt" = now(),
			"updatedAt" = now()
		from claimed
		where slot.slot = $3
			and slot."objectRemoteId" is null
		returning slot.slot
	), root_cursor_update as (
		update "history_archive_object_queue" root
		set "lastClaimedAt" = claimed."lastClaimedAt"
		from claimed
		where root."archiveUrlIdentity" = claimed."archiveUrlIdentity"
			and claimed."objectType" <> 'history-archive-state'
			and root."objectType" = 'history-archive-state'
			and root."objectKey" = 'root'
		returning root.id
	)
	select
		claimed."remoteId" as "remoteId",
		claimed."archiveUrl" as "archiveUrl",
		claimed."archiveUrlIdentity" as "archiveUrlIdentity",
		claimed."hostIdentity" as "hostIdentity",
		claimed."objectType" as "objectType",
		claimed."objectKey" as "objectKey",
		claimed."objectOrder" as "objectOrder",
		claimed."objectUrl" as "objectUrl",
		claimed.status as status,
		claimed."workerStage" as "workerStage",
		claimed."checkpointLedger" as "checkpointLedger",
		claimed."bucketHash" as "bucketHash",
		claimed."bytesDownloaded" as "bytesDownloaded",
		claimed.attempts as attempts,
		claimed."nextAttemptAt" as "nextAttemptAt",
		claimed."refreshAfter" as "refreshAfter",
		claimed."claimedAt" as "claimedAt",
		claimed."claimedByCommunityScannerId" as "claimedByCommunityScannerId",
		claimed."errorType" as "errorType",
		claimed."errorMessage" as "errorMessage",
		claimed."httpStatus" as "httpStatus",
		claimed."verificationFacts" as "verificationFacts",
		claimed."verifiedAt" as "verifiedAt",
		claimed."createdAt" as "createdAt",
		claimed."updatedAt" as "updatedAt"
	from claimed
	cross join occupied_slot
	left join root_cursor_update on true
`;
