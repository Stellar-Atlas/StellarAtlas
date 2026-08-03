const claimGateKeySql =
	"hashtextextended('history_archive_object_claim_gate', 104729)";

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
	select claim_gate.locked,
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
		select active."remoteId",
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
		select available_slots.slot,
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
	select adoption_guard.locked,
		(select count(*)::integer from untracked_active) as "untrackedObjects",
		(select count(*)::integer from adopted_slots) as "adoptedObjects"
	from adoption_guard
`;

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

export const historyArchiveObjectClaimSql = `
	with free_slot as materialized (
		select slot.slot
		from "history_archive_object_claim_slot" slot
		where slot."objectRemoteId" is null
			and slot.slot < $3
		order by slot.slot
		for update of slot skip locked
		limit 1
	), active_claims as materialized (
		select active."archiveUrlIdentity", active."hostIdentity"
		from "history_archive_object_claim_slot" occupied
		join "history_archive_object_queue" active
			on active."remoteId" = occupied."objectRemoteId"
			and active.status = 'scanning'
	), active_by_archive as materialized (
		select "archiveUrlIdentity", count(*)::integer as count
		from active_claims
		group by "archiveUrlIdentity"
	), active_by_host as materialized (
		select "hostIdentity", count(*)::integer as count
		from active_claims
		group by "hostIdentity"
	), selected as materialized (
		select candidate.id, candidate."remoteId", candidate."archiveUrlIdentity",
			candidate."hostIdentity", candidate."objectType", free_slot.slot,
			ready.priority
		from "history_archive_object_ready" ready
		join "history_archive_object_queue" candidate
			on candidate."remoteId" = ready."objectRemoteId"
		cross join free_slot
		left join active_by_archive archive_activity
			on archive_activity."archiveUrlIdentity" =
				candidate."archiveUrlIdentity"
		left join active_by_host host_activity
			on host_activity."hostIdentity" = candidate."hostIdentity"
		where ready."availableAt" <= now()
			and candidate."objectType" = any($1)
			and (
				${pendingReadySql}
				or (free_slot.slot % 2 = 0 and ${failedReadySql})
			)
			and candidate."executionDisposition" = 'executable'
			and candidate."dependencyReady" = true
			and (
				candidate."transitionEffectsRequiredAt" is null
				or candidate."transitionEffectsCompletedAt" is not null
			)
			and coalesce(archive_activity.count, 0) < $2
			and coalesce(host_activity.count, 0) < $4
			and not exists (
				select 1
				from "history_archive_object_host_throttle" throttle
				where throttle."hostIdentity" = candidate."hostIdentity"
					and throttle."blockedUntil" > now()
			)
		order by
			case
				when free_slot.slot % 2 = 0 and candidate.status = 'failed' then 0
				else 1
			end,
			ready.priority,
			ready."createdAt",
			candidate."lastClaimedAt" asc nulls first,
			candidate."objectOrder",
			candidate."checkpointLedger" desc nulls last,
			candidate."objectKey",
			candidate.id
		for update of ready, candidate skip locked
		limit 1
	), host_gate as materialized (
		select selected.*,
			pg_try_advisory_xact_lock(
				hashtextextended(selected."hostIdentity", 104729)
			) as locked
		from selected
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
		from host_gate
		where host_gate.locked
			and candidate.id = host_gate.id
		returning candidate.*
	), occupied_slot as (
		update "history_archive_object_claim_slot" slot
		set "objectRemoteId" = claimed."remoteId",
			"claimedAt" = now(),
			"updatedAt" = now()
		from claimed, host_gate
		where slot.slot = host_gate.slot
			and slot."objectRemoteId" is null
		returning slot.slot
	), removed_ready as (
		delete from "history_archive_object_ready" ready
		using claimed
		where ready."objectRemoteId" = claimed."remoteId"
		returning ready."objectRemoteId"
	), committed_claim as materialized (
		select claimed.*
		from claimed
		cross join occupied_slot
		cross join removed_ready
	)
	select
		case
			when committed_claim.id is not null then 'claimed'
			when host_gate.id is not null then 'contended'
			else 'idle'
		end as outcome,
		committed_claim.*
	from (select 1) anchor
	left join host_gate on true
	left join committed_claim on true
`;
