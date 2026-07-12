import { historyArchiveObjectDependencySatisfiedSql } from './HistoryArchiveObjectDependencySql.js';

const candidateDependencyReadySql =
	historyArchiveObjectDependencySatisfiedSql('candidate');

export const historyArchiveObjectClaimSql = `
	with cleaned_slots as (
		update "history_archive_object_claim_slot" slot
		set "objectRemoteId" = null,
			"claimedAt" = null,
			"updatedAt" = now()
		where slot."objectRemoteId" is not null
			and not exists (
				select 1
				from "history_archive_object_queue" active
				where active."remoteId" = slot."objectRemoteId"
					and active.status = 'scanning'
			)
		returning slot.slot
	), adoption_state as materialized (
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
		cross join (select count(*) from cleaned_slots) cleanup
		cross join adoption_guard
		where active.status = 'scanning'
			and adoption_guard.locked
			and not exists (
				select 1
				from "history_archive_object_claim_slot" occupied
				where occupied."objectRemoteId" = active."remoteId"
			)
		order by active."claimedAt" nulls first, active.id
		limit $3
	), adoption_slots as materialized (
		select
			slot.slot,
			row_number() over (order by slot.slot) as position
		from "history_archive_object_claim_slot" slot
		cross join adoption_guard
		where slot."objectRemoteId" is null
			and slot.slot < $3
			and adoption_guard.locked
		order by slot.slot
		limit $3
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
	), free_slot as materialized (
		select slot.slot
		from "history_archive_object_claim_slot" slot
		cross join adoption_guard
		cross join (select count(*) from adopted_slots) adoption
		where slot."objectRemoteId" is null
			and slot.slot < $3
			and adoption_guard.locked
			and not exists (
				select 1 from adopted_slots where adopted_slots.slot = slot.slot
			)
		order by slot.slot
		for update of slot skip locked
		limit 1
	), root_candidate as materialized (
		select
			root.id,
			root."archiveUrlIdentity",
			root."hostIdentity",
			root."lastClaimedAt"
		from "history_archive_object_queue" root
		cross join free_slot
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
			and (
				exists (
					select 1
					from "history_archive_object_queue" candidate
					where candidate."archiveUrlIdentity" =
						root."archiveUrlIdentity"
						and candidate.status = 'pending'
						and (
							candidate."transitionEffectsRequiredAt" is null
							or candidate."transitionEffectsCompletedAt" is not null
						)
						and candidate."executionDisposition" = 'executable'
						and ${candidateDependencyReadySql}
						and candidate."objectType" = any($1)
						and (
							candidate."nextAttemptAt" is null
							or candidate."nextAttemptAt" <= now()
						)
					limit 1
				)
				or exists (
					select 1
					from "history_archive_object_queue" candidate
					where candidate."archiveUrlIdentity" =
						root."archiveUrlIdentity"
						and candidate.status = 'failed'
						and (
							candidate."transitionEffectsRequiredAt" is null
							or candidate."transitionEffectsCompletedAt" is not null
						)
						and candidate."executionDisposition" = 'executable'
						and ${candidateDependencyReadySql}
						and candidate."objectType" = any($1)
						and coalesce(
							candidate."nextAttemptAt",
							candidate."updatedAt" + interval '1 hour'
						) <= now()
					limit 1
				)
			)
		order by root."lastClaimedAt" asc nulls first, root.id
		for update of root skip locked
		limit 1
	), host_lock as materialized (
		select
			root_candidate.*,
			pg_try_advisory_xact_lock(
				hashtextextended(root_candidate."hostIdentity", 104729)
			) as locked
		from root_candidate
	), pending_candidate as materialized (
		select candidate.id
		from "history_archive_object_queue" candidate
		join host_lock root
			on root."archiveUrlIdentity" = candidate."archiveUrlIdentity"
		where root.locked
			and candidate.status = 'pending'
			and (
				candidate."transitionEffectsRequiredAt" is null
				or candidate."transitionEffectsCompletedAt" is not null
			)
			and candidate."executionDisposition" = 'executable'
			and ${candidateDependencyReadySql}
			and candidate."objectType" = any($1)
			and (
				candidate."nextAttemptAt" is null
				or candidate."nextAttemptAt" <= now()
			)
			and (
				select count(*)
				from "history_archive_object_queue" active
				where active."hostIdentity" = root."hostIdentity"
					and active.status = 'scanning'
			) < $4
		order by
			case candidate."executionReason"
				when 'canonical-frontier-reserve' then 0
				when 'proof-completion-reserve' then 1
				else 2
			end,
			candidate."lastClaimedAt" asc nulls first,
			candidate."objectOrder",
			candidate."checkpointLedger" desc nulls last,
			candidate."objectKey",
			candidate.id
		for update of candidate skip locked
		limit 1
	), failed_candidate as materialized (
		select candidate.id
		from "history_archive_object_queue" candidate
		join host_lock root
			on root."archiveUrlIdentity" = candidate."archiveUrlIdentity"
		where root.locked
			and candidate.status = 'failed'
			and (
				candidate."transitionEffectsRequiredAt" is null
				or candidate."transitionEffectsCompletedAt" is not null
			)
			and candidate."executionDisposition" = 'executable'
			and ${candidateDependencyReadySql}
			and candidate."objectType" = any($1)
			and coalesce(
				candidate."nextAttemptAt",
				candidate."updatedAt" + interval '1 hour'
			) <= now()
			and (
				select count(*)
				from "history_archive_object_queue" active
				where active."hostIdentity" = root."hostIdentity"
					and active.status = 'scanning'
			) < $4
		order by
			candidate."nextAttemptAt" asc nulls first,
			candidate."lastClaimedAt" asc nulls first,
			candidate."objectOrder",
			candidate."objectKey",
			candidate.id
		for update of candidate skip locked
		limit 1
	), selected as (
		select
			case
				when free_slot.slot % 4 = 0
					then coalesce(failed_candidate.id, pending_candidate.id)
				else coalesce(pending_candidate.id, failed_candidate.id)
			end as id,
			free_slot.slot
		from free_slot
		left join pending_candidate on true
		left join failed_candidate on true
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
		from selected
		where candidate.id = selected.id
		returning candidate.*
	), occupied_slot as (
		update "history_archive_object_claim_slot" slot
		set "objectRemoteId" = claimed."remoteId",
			"claimedAt" = now(),
			"updatedAt" = now()
		from claimed, selected
		where slot.slot = selected.slot
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
