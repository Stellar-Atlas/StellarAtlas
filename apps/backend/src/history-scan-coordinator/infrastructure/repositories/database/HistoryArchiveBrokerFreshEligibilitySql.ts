import { historyArchiveCheckpointNotFoundCooldownSql } from './HistoryArchiveObjectReadyQueue.js';
import { historyArchiveRootControlAllowedSql } from './HistoryArchiveRootFailureControl.js';
import { historyArchiveHostScanAllowedSql } from '../../../domain/history-archive-object/HistoryArchiveScanPolicy.js';
import { historyArchiveCanonicalFirstAdmissionSql } from './HistoryArchiveCanonicalFirst.js';

/** Only the first-pass projection lane may use this specialization. Pending,
 * never-attempted objects cannot be retries: retained evidence is irrelevant to
 * their priority/flags, and the first-pass policy is already satisfied. Mutable
 * admission, source controls, and execution-token semantics remain unchanged. */
export interface BrokerFreshEligibilityRelations {
	readonly ready?: 'history_archive_object_ready' | 'ram_ready';
	readonly object?: 'history_archive_broker_candidate' | 'ram_objects';
	readonly control?:
		'history_archive_root_failure_control' | 'ram_root_controls';
}

export function historyArchiveBrokerFreshEligibilitySql(
	relations: BrokerFreshEligibilityRelations = {}
): string {
	const controlRelation =
		relations.control ?? 'history_archive_root_failure_control';
	// Reuse the complete authoritative policy against locked control versions;
	// this is a relation substitution only, not a second policy implementation.
	const rootAllowed = historyArchiveRootControlAllowedSql('object').replaceAll(
		'history_archive_root_failure_control',
		controlRelation
	);
	return `
		select ready."objectRemoteId", ready."archiveUrlIdentity",
			ready.priority as stored_priority, ready.priority as priority,
			true as is_first_pass, ready."dispatchToken", ready."updatedAt",
			object."hostIdentity", object."checkpointLedger", object."objectOrder",
			object."objectType", control.scope as control_scope,
			false as is_transient_source_retry, false as is_retry,
			coalesce(active.active_count, 0) as active_count
		from ${relations.ready ?? 'history_archive_object_ready'} ready
		join ${relations.object ?? 'history_archive_broker_candidate'} object
			on object."remoteId"=ready."objectRemoteId"
		left join active_hosts active on active."hostIdentity"=object."hostIdentity"
		left join lateral (
			select scope from ${controlRelation} control
			where control."archiveUrlIdentity"=object."archiveUrlIdentity"
				and control.scope in ('*',object."objectType")
				and (control."blockedUntil" is not null
					or coalesce(jsonb_array_length(control."adaptiveProbeState"->'unknown'),0)>0)
			order by scope limit 1
		) control on true
		where object.status='pending' and object.attempts=0
			and ready."publishedAt" is null
			and ${rootAllowed}
			and ${historyArchiveHostScanAllowedSql('object')}
			and ready."availableAt"<=now()
			and (ready."dispatchToken" is not null or (
				object."executionDisposition"='executable' and object."dependencyReady"=true
				and (object."transitionEffectsRequiredAt" is null
					or object."transitionEffectsCompletedAt" is not null)
			))
			and ready.priority<=$3::smallint
			and (ready."dispatchToken" is not null
				or ${historyArchiveCanonicalFirstAdmissionSql('ready."archiveUrlIdentity"', '$4::text')})
			and not exists (select 1 from history_archive_object_host_throttle throttle
				where throttle."hostIdentity"=object."hostIdentity" and throttle."blockedUntil">now())
			and (ready."dispatchToken" is not null
				or ${historyArchiveCheckpointNotFoundCooldownSql('object')})
	`;
}
