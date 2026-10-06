import { historyArchiveBrokerReservationTailSql } from './HistoryArchiveBrokerReservationTailSql.js';
import { historyArchiveCheckpointNotFoundCooldownSql } from './HistoryArchiveObjectReadyQueue.js';
import { historyArchiveBrokerFirstPassAdmissionSql } from './HistoryArchiveBrokerFirstPassAdmissionSql.js';
import { historyArchiveBrokerFreshEligibilitySql } from './HistoryArchiveBrokerFreshEligibilitySql.js';
import {
	getHistoryArchiveRetryPhase,
	type HistoryArchiveRetryPhase,
	historyArchiveNeverAttemptedSql
} from './HistoryArchiveFirstPassPolicy.js';
import { historyArchiveRootControlAllowedSql } from './HistoryArchiveRootFailureControl.js';
import { historyArchiveHostScanAllowedSql } from '../../../domain/history-archive-object/HistoryArchiveScanPolicy.js';
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
export function buildReserveBrokerJobsSql(
	preferRetryOnSingleSlot: boolean,
	candidateRelation:
		| 'history_archive_broker_candidate'
		| 'history_archive_object_queue' = 'history_archive_broker_candidate',
	phase: HistoryArchiveRetryPhase = getHistoryArchiveRetryPhase()
): string {
	const firstPass = phase === 'first-pass';
	const neverAttempted = historyArchiveNeverAttemptedSql('object');
	const transientRetry = firstPass
		? `(not ${neverAttempted} and ${transientSourceRetrySql})`
		: transientSourceRetrySql;
	const eligibleSql = `
		select ready."objectRemoteId",
			ready."archiveUrlIdentity",
			ready.priority as stored_priority,
			case when ${transientRetry} then 0 else ready.priority end as priority,
			${firstPass ? neverAttempted : 'false'} as is_first_pass,
			ready."dispatchToken",
			ready."updatedAt",
			object."hostIdentity",
			object."checkpointLedger", object."objectOrder",object."objectType",
			control.scope as control_scope,
			${transientRetry} as is_transient_source_retry,
			(object.status = 'failed' and not ${transientRetry}
				and ${historyArchiveInconclusiveTransportFailureSql('object')}) as is_retry,
			coalesce(active.active_count, 0) as active_count
		from "history_archive_object_ready" ready
		join "${candidateRelation}" object
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
			and ${historyArchiveManualOrAutomaticSourceRetrySql('object', 'ready', phase)}
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
	`;
	const admission =
		firstPass && candidateRelation === 'history_archive_broker_candidate'
			? historyArchiveBrokerFirstPassAdmissionSql(
					eligibleSql,
					historyArchiveBrokerFreshEligibilitySql()
				)
			: `eligible as materialized (select source.*,null::timestamptz as first_pass_root_ready_at from (${eligibleSql}) source)`;
	return `
	with ${historyArchiveCanonicalFirstScopeCteSql('$4::text')}, active_hosts as materialized (
		select object."hostIdentity", count(*)::integer as active_count
		from "history_archive_object_ready" ready
		join "history_archive_object_queue" object
			on object."remoteId" = ready."objectRemoteId"
		where ready."publishedAt" is not null
		group by object."hostIdentity"
	), ${admission}, ${historyArchiveBrokerReservationTailSql(preferRetryOnSingleSlot)}
`;
}

// Enable only after the additive projection migration and bounded ready-only
// bootstrap have completed. Old binaries and rollback keep the original path.
export const historyArchiveBrokerCandidateProjectionEnabled =
	process.env.HISTORY_ARCHIVE_BROKER_CANDIDATE_PROJECTION_ENABLED === 'true';
const brokerCandidateRelation = historyArchiveBrokerCandidateProjectionEnabled
	? 'history_archive_broker_candidate'
	: 'history_archive_object_queue';
export const reserveBrokerJobsSql = buildReserveBrokerJobsSql(
	false,
	brokerCandidateRelation
);
export const reserveBrokerSingleSlotRetrySql = buildReserveBrokerJobsSql(
	true,
	brokerCandidateRelation
);
