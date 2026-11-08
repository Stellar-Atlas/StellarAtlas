import { historyArchiveProofCompletionReserveMemberSql } from './HistoryArchiveProofCompletionReserveSql.js';
import { historyArchiveCheckpointNotFoundCooldownSql } from './HistoryArchiveObjectReadyQueue.js';
import { historyArchiveRootControlAllowedSql } from './HistoryArchiveRootFailureControl.js';
import { historyArchiveHostScanAllowedSql } from '../../../domain/history-archive-object/HistoryArchiveScanPolicy.js';
import { historyArchiveCanonicalFirstAdmissionSql } from './HistoryArchiveCanonicalFirst.js';
import { historyArchiveCheckpointBucketDependenciesSql } from './HistoryArchiveCheckpointDependencyReadSql.js';
import { remoteCheckpointFailureExistsSql } from './HistoryArchiveCheckpointRemoteFailureSql.js';
import { canonicalVerifiedBoundarySql } from './HistoryArchiveCanonicalFallbackAnchorSql.js';

/** The default projection specialization remains pending, never-attempted.
 * Only bounded RAM callers may opt into strict header-completion reserves;
 * durable queue/proof state authorizes them, never a RAM flag. This does not
 * enable ordinary retries. Mutable admission, source controls, and
 * execution-token semantics remain unchanged. */
export interface BrokerFreshEligibilityRelations {
	readonly ready?: 'history_archive_object_ready' | 'ram_ready';
	readonly object?: 'history_archive_broker_candidate' | 'ram_objects';
	readonly control?:
		'history_archive_root_failure_control' | 'ram_root_controls';
	readonly fallbackObjectIds?: string;
	readonly allowProofCompletionReserve?: boolean;
}

export function historyArchiveBrokerFreshEligibilitySql(
	relations: BrokerFreshEligibilityRelations = {}
): string {
	const firstPassEligibility = relations.allowProofCompletionReserve === true
		? `(object.attempts=0 or exists (
			select 1 from history_archive_object_queue reserve_object
			where reserve_object."remoteId"=object."remoteId"
				and reserve_object.status='pending'
				and ${historyArchiveProofCompletionReserveMemberSql('reserve_object')}))`
		: 'object.attempts=0';
	const controlRelation =
		relations.control ?? 'history_archive_root_failure_control';
	// Reuse the complete authoritative policy against locked control versions;
	// this is a relation substitution only, not a second policy implementation.
	const rootAllowed = historyArchiveRootControlAllowedSql('object').replaceAll(
		'history_archive_root_failure_control',
		controlRelation
	);
	const fallbackAdmission = relations.fallbackObjectIds
		? `exists (
			select 1
			from unnest(${relations.fallbackObjectIds}) allowlisted("remoteId")
			join "history_archive_object_queue" marked
				on marked."remoteId" = allowlisted."remoteId"
			join "history_archive_checkpoint_scan_cursor" canonical_cursor
				on canonical_cursor."archiveUrlIdentity" = $4::text
			join "history_archive_state_snapshot" canonical_state
				on canonical_state."archiveUrlIdentity" = $4::text
			join "history_archive_state_snapshot" alternate_state
				on alternate_state."archiveUrlIdentity" = marked."archiveUrlIdentity"
			where marked."executionReason" = 'canonical-frontier-alternate'
				and marked."objectType" = 'checkpoint-state'
				and marked.status in ('pending','scanning','verified')
				and marked."archiveUrlIdentity" = object."archiveUrlIdentity"
				and marked."checkpointLedger" =
					canonical_cursor."nextHistoricalCheckpointLedger" - 64
				and canonical_state.status = 'available'
				and alternate_state.status = 'available'
				and alternate_state."networkPassphrase" = canonical_state."networkPassphrase"
				and alternate_state."currentLedger" >= marked."checkpointLedger"
				and object."archiveUrlIdentity" <> $4::text
				and object."remoteId" = any(${relations.fallbackObjectIds})
				and (select incomplete from canonical_scope)
				and exists (
					select 1 from "history_archive_checkpoint_proof" failed
					where failed."archiveUrlIdentity" = $4::text
						and failed."checkpointLedger" = marked."checkpointLedger"
						and failed.status = 'not-evaluable'
						and failed."failureKind" = 'object-failed'
						and ${remoteCheckpointFailureExistsSql('failed')}
				)
				and exists (${canonicalVerifiedBoundarySql(
					'$4::text',
					'marked."checkpointLedger" - 64'
				)})
				and (
					object."remoteId" = marked."remoteId"
					or (object."archiveUrlIdentity" = marked."archiveUrlIdentity"
						and object."checkpointLedger" = marked."checkpointLedger"
						and object."objectType" in ('ledger','transactions','results'))
					or (object."archiveUrlIdentity" = marked."archiveUrlIdentity"
						and object."objectType" = 'bucket' and exists (
						select 1 from lateral (
							${historyArchiveCheckpointBucketDependenciesSql(
								'marked."archiveUrlIdentity"',
								'marked."checkpointLedger"'
							)}
						) dependency
						where dependency."bucketHash" = object."bucketHash"
					))
				)
			)`
		: 'false';
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
		where object.status='pending' and ${firstPassEligibility}
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
				or ${historyArchiveCanonicalFirstAdmissionSql('ready."archiveUrlIdentity"', '$4::text')}
				or ${fallbackAdmission})
			and not exists (select 1 from history_archive_object_host_throttle throttle
				where throttle."hostIdentity"=object."hostIdentity" and throttle."blockedUntil">now())
			and (ready."dispatchToken" is not null
				or ${historyArchiveCheckpointNotFoundCooldownSql('object')})
	`;
}
