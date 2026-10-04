import { historyArchiveCheckpointNotFoundCooldownSql } from './HistoryArchiveObjectReadyQueue.js';
import { historyArchiveRootControlAllowedSql } from './HistoryArchiveRootFailureControl.js';
import { historyArchiveHostScanAllowedSql } from '../../../domain/history-archive-object/HistoryArchiveScanPolicy.js';
import { historyArchiveRetryLaneDivisor } from '../../../domain/history-archive-object/HistoryArchiveInconclusiveRetry.js';
import { historyArchiveInconclusiveTransportFailureSql } from './HistoryArchiveFailureAttributionSql.js';
import {
	currentTransientSourceFailureSql,
	historyArchiveTransientSourceFailureSql,
	historyArchiveAllowsAutomaticSourceRetrySql,
	historyArchiveManualOrAutomaticSourceRetrySql
} from './HistoryArchiveTransientSourceRetry.js';
import {
	historyArchiveCanonicalFirstAdmissionSql,
	historyArchiveCanonicalFirstScopeCteSql
} from './HistoryArchiveCanonicalFirst.js';

// The ready table is the materialized sequential-cohort admission result. Re-running
// the bucket-set cohort EXISTS tree while reserving every broker batch turns a
// constant-size dequeue into a scan of checkpoint dependency history. Keep only
// cheap mutable-state guards here; ready-queue reconciliation owns cohort changes.
const brokerReservationSchedulableObjectSql = `
	object."executionDisposition" = 'executable'
	and object."dependencyReady" = true
	and (
		object."transitionEffectsRequiredAt" is null
		or object."transitionEffectsCompletedAt" is not null
	)
	and (
		object.status = 'pending'
		or (
			object.status = 'failed'
			and object."nextAttemptAt" is not null
			and object."nextAttemptAt" <= now()
			and ${historyArchiveAllowsAutomaticSourceRetrySql('object')}
		)
	)
`;

const transientSourceRetrySql = `(
	coalesce(object.status = 'failed' and object."httpStatus" between 500 and 599, false)
	or (ready.priority = 0 and ready."dispatchToken" is not null and ${currentTransientSourceFailureSql})
	or retained."objectRemoteId" is not null
)`;

// Round-robin within each priority across eligible roots; ledger order is local
// to a root. Apply the same rounds before host caps so shared hosts stay fair.
function buildReserveBrokerJobsSql(preferRetryOnSingleSlot: boolean): string {
	return `
	with ${historyArchiveCanonicalFirstScopeCteSql('$4::text')}, active_hosts as materialized (
		select object."hostIdentity", count(*)::integer as active_count
		from "history_archive_object_ready" ready
		join "history_archive_object_queue" object
			on object."remoteId" = ready."objectRemoteId"
		where ready."publishedAt" is not null
		group by object."hostIdentity"
	), eligible as materialized (
		select ready."objectRemoteId",
			ready."archiveUrlIdentity",
			ready.priority as stored_priority,
			case when ${transientSourceRetrySql} then 0 else ready.priority end as priority,
			ready."dispatchToken",
			ready."updatedAt",
			object."hostIdentity",
			object."checkpointLedger", object."objectOrder",object."objectType",
			control.scope as control_scope,
			${transientSourceRetrySql} as is_transient_source_retry,
			(object.status = 'failed' and not ${transientSourceRetrySql}
				and ${historyArchiveInconclusiveTransportFailureSql('object')}) as is_retry,
			coalesce(active.active_count, 0) as active_count
		from "history_archive_object_ready" ready
		join "history_archive_object_queue" object
			on object."remoteId" = ready."objectRemoteId"
		left join history_archive_retained_remote_finding retained
			on retained."objectRemoteId" = object."remoteId"
			and retained."retainedOnly" and ${historyArchiveTransientSourceFailureSql('retained')}
			and ${historyArchiveAllowsAutomaticSourceRetrySql('object')}
		left join active_hosts active
			on active."hostIdentity" = object."hostIdentity"
		left join lateral (
			select scope from history_archive_root_failure_control control
			where control."archiveUrlIdentity"=object."archiveUrlIdentity"
				and control.scope in ('*',object."objectType")
				and (control."blockedUntil" is not null or coalesce(jsonb_array_length(control."adaptiveProbeState"->'unknown'),0)>0)
			order by scope limit 1
		) control on true
		where ready."publishedAt" is null
			and ${historyArchiveRootControlAllowedSql('object')}
			and ${historyArchiveHostScanAllowedSql('object')}
			and ${historyArchiveManualOrAutomaticSourceRetrySql('object', 'ready')}
			and ready."availableAt" <= now()
			and (
				ready."dispatchToken" is not null
				or (${brokerReservationSchedulableObjectSql})
			)
			and ready.priority <= $3::smallint
			and (
				ready."dispatchToken" is not null
				or ${historyArchiveCanonicalFirstAdmissionSql('ready."archiveUrlIdentity"', '$4::text')}
			)
			and not exists (
				select 1
				from "history_archive_object_host_throttle" throttle
				where throttle."hostIdentity" = object."hostIdentity"
					and throttle."blockedUntil" > now()
			)
			and (
				ready."dispatchToken" is not null
				or ${historyArchiveCheckpointNotFoundCooldownSql('object')}
			)
	), root_probe_ranked as materialized (
		select eligible.*,row_number() over (
			partition by "archiveUrlIdentity",control_scope
			order by priority,"checkpointLedger" asc nulls first,"objectOrder","objectRemoteId"
		) as probe_rank from eligible
	), root_rounds as materialized (
		select candidate.*,
			min(candidate."updatedAt") over (
				partition by candidate.is_transient_source_retry, candidate.is_retry, candidate.priority, candidate."archiveUrlIdentity"
			) as root_ready_at,
			row_number() over (
				partition by candidate.is_transient_source_retry, candidate.is_retry, candidate.priority, candidate."archiveUrlIdentity"
				order by candidate."checkpointLedger" asc nulls first,
					candidate."objectOrder", candidate."updatedAt",
					candidate."objectRemoteId"
			) as root_round
		from root_probe_ranked candidate
		where candidate.control_scope is null or candidate.probe_rank=1
	), retry_ranked as materialized (
		select root_rounds.*, row_number() over (
			partition by is_retry order by priority, root_round, root_ready_at,
				"archiveUrlIdentity", "objectRemoteId"
		) as retry_rank
		from root_rounds
	), retry_budgeted as materialized (
		select candidate.* from retry_ranked candidate
		where not candidate.is_retry
			or candidate.retry_rank <= case when $1::integer = 1
				then ${preferRetryOnSingleSlot ? 1 : 0}
				else $1::integer / ${historyArchiveRetryLaneDivisor} end
			or not exists (select 1 from eligible where not is_retry)
	), ranked as materialized (
		select candidate."objectRemoteId", candidate.priority,
			candidate.is_retry, candidate.is_transient_source_retry,
			candidate.stored_priority, candidate."updatedAt",
			candidate."archiveUrlIdentity", candidate.root_round, candidate.root_ready_at,
			candidate."hostIdentity", candidate.active_count,
			candidate."checkpointLedger", candidate."objectOrder",candidate."objectType",candidate.control_scope,
			row_number() over (
				partition by candidate."hostIdentity"
				order by candidate.is_transient_source_retry desc, candidate.is_retry desc, candidate.priority, candidate.root_round,
					candidate.root_ready_at, candidate."archiveUrlIdentity",
					candidate."objectRemoteId"
			) as host_rank
		from retry_budgeted candidate
	), selected as materialized (
		select ranked."objectRemoteId", ranked.priority,
			ranked.is_transient_source_retry,
			ranked.stored_priority,
			ranked."checkpointLedger", ranked."objectOrder",ranked."objectType",ranked.control_scope,
			ranked."archiveUrlIdentity",
			(row_number() over (
				order by ranked.is_transient_source_retry desc, ranked.is_retry desc, ranked.priority, ranked.root_round, ranked.root_ready_at,
					ranked.active_count, ranked."archiveUrlIdentity", ranked.host_rank,
					ranked."objectRemoteId"
			))::integer as "selectedOrdinal"
		from ranked
		where ranked.active_count + ranked.host_rank <= $2::integer
		order by ranked.is_transient_source_retry desc, ranked.is_retry desc, ranked.priority, ranked.root_round, ranked.root_ready_at,
			ranked.active_count, ranked."archiveUrlIdentity", ranked.host_rank,
			ranked."objectRemoteId"
		limit $1::integer
	), lockable as materialized (
		select ready."objectRemoteId"
		from "history_archive_object_ready" ready
		join selected
			on selected."objectRemoteId" = ready."objectRemoteId"
		-- Completion acknowledgements lock the same table first. A single
		-- objectRemoteId order prevents overlapping batches from reversing it.
		order by ready."objectRemoteId"
		for update of ready skip locked
	), retry_object_lockable as materialized (
		select object."remoteId" from lockable
		join selected on selected."objectRemoteId"=lockable."objectRemoteId"
		join history_archive_object_queue object on object."remoteId"=selected."objectRemoteId"
		where selected.is_transient_source_retry
		order by object."archiveUrlIdentity",object."objectType",object."objectKey"
		for update of object
	), root_control_lockable as materialized (
		select control.* from history_archive_root_failure_control control
		cross join (select count(*) from retry_object_lockable) ordered_objects
		where exists (select 1 from selected join lockable using ("objectRemoteId")
			where selected."archiveUrlIdentity"=control."archiveUrlIdentity"
				and control.scope in ('*',selected."objectType"))
		order by control."archiveUrlIdentity",control.scope for update of control
	), guarded as materialized (
		select selected.* from selected where not exists (
			select 1 from root_control_lockable control
			where control."archiveUrlIdentity"=selected."archiveUrlIdentity"
				and control.scope in ('*',selected."objectType")
				and (control."blockedUntil">now() or control."probeLeaseUntil">now()
					or (coalesce(jsonb_array_length(control."adaptiveProbeState"->'unknown'),0)>0
						and selected."checkpointLedger" is distinct from control."nextProbeCheckpoint"))
		)
	), reserved as (
		update "history_archive_object_ready" ready
		set "dispatchToken" = coalesce(ready."dispatchToken", gen_random_uuid()),
			priority = case
				when ready."dispatchToken" is null then selected.priority
				else ready.priority
			end,
			"claimAttempt" = coalesce(ready."claimAttempt", object.attempts + 1),
			"publishedAt" = now(),
			"updatedAt" = now()
		from "history_archive_object_queue" object, guarded selected, lockable
		where ready."objectRemoteId" = object."remoteId"
			and ready."objectRemoteId" = selected."objectRemoteId"
			and ready."objectRemoteId" = lockable."objectRemoteId"
		returning
			ready."objectRemoteId",
			ready."dispatchToken",
			ready."claimAttempt",
			object."remoteId",
			object."archiveUrl",
			object."objectType",
			object."objectKey",
			object."objectUrl",
			object."checkpointLedger",
			object."bucketHash"
	), retry_attempts_recorded as (
		update history_archive_object_queue object set "lastClaimedAt" = now()
		from retry_object_lockable, reserved where object."remoteId" = retry_object_lockable."remoteId"
			and reserved."remoteId"=object."remoteId"
		returning object."remoteId"
	), root_probes_leased as (
		update history_archive_root_failure_control control set
			"probeExecutionId"=reserved."dispatchToken","probeLeaseUntil"=now()+interval '2 minutes',
			version=control.version+1,"updatedAt"=now()
		from reserved,selected,root_control_lockable locked
		where selected."objectRemoteId"=reserved."objectRemoteId"
			and control."archiveUrlIdentity"=selected."archiveUrlIdentity"
			and control.scope in ('*',selected."objectType")
			and locked."archiveUrlIdentity"=control."archiveUrlIdentity" and locked.scope=control.scope
			and (control."blockedUntil" is not null or coalesce(jsonb_array_length(control."adaptiveProbeState"->'unknown'),0)>0)
		returning control."archiveUrlIdentity",control.scope,control."probeExecutionId",
			(control.scope='checkpoint-state' and control."failureKind"='missing'
				and control."consecutiveFailures">=3
				and (control."listingCheckedAt" is null or control."listingCheckedAt"<=now()-interval '24 hours')) as "allowListingDiscovery"
	)
	select reserved."dispatchToken", reserved."claimAttempt",
		reserved."remoteId", reserved."archiveUrl", reserved."objectType",
		reserved."objectKey", reserved."objectUrl",
		reserved."checkpointLedger", reserved."bucketHash",
		selected.priority, selected."selectedOrdinal",
		coalesce((select bool_or(probe."allowListingDiscovery") from root_probes_leased probe
			where probe."probeExecutionId"=reserved."dispatchToken"),false) as "allowListingDiscovery"
	from reserved
	join selected
		on selected."objectRemoteId" = reserved."objectRemoteId"
	order by selected."selectedOrdinal"
`;
}

export const reserveBrokerJobsSql = buildReserveBrokerJobsSql(false);
export const reserveBrokerSingleSlotRetrySql = buildReserveBrokerJobsSql(true);
