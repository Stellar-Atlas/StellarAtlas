import { activeListingGapCountSql } from './KnownArchiveListingGapQuery.js';
import { historyArchivePublicSourcePredicateSql } from './HistoryArchivePublicSourceScopeSql.js';
import { retainedRemoteCountSql } from './RetainedRemoteFindingQuery.js';
import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
export const sourceStatusSummarySql = `
	with source_aliases as materialized (
		select "archiveUrl", "archiveUrlIdentity"
		from history_archive_state_snapshot
		where ${historyArchivePublicSourcePredicateSql}
	), current_state as (
		select distinct on ("archiveUrl")
			"archiveUrl",
			"archiveUrlIdentity",
			"stateUrl",
			status,
			"observedAt",
			source,
			"currentLedger"
		from history_archive_state_snapshot
		where ${historyArchivePublicSourcePredicateSql}
		order by
			"archiveUrl",
			"observedAt" desc,
			("archiveUrlIdentity" = "archiveUrl") desc,
			"archiveUrlIdentity"
	), root_object_by_identity as (
		select distinct on ("archiveUrlIdentity")
			"archiveUrlIdentity",
			status as "rootObjectStatus",
			"failureChannel" as "rootFailureChannel",
			"updatedAt"
		from history_archive_object_queue
		where "objectType" = 'history-archive-state'
		order by "archiveUrlIdentity", "updatedAt" desc
	), root_object as (
		select distinct on (aliases."archiveUrl")
			aliases."archiveUrl",
			root."rootObjectStatus",
			root."rootFailureChannel"
		from source_aliases aliases
		join root_object_by_identity root
			on root."archiveUrlIdentity" = aliases."archiveUrlIdentity"
		order by
			aliases."archiveUrl",
			root."updatedAt" desc,
			(root."archiveUrlIdentity" = aliases."archiveUrl") desc,
			root."archiveUrlIdentity"
	), object_health as (
		select
			aliases."archiveUrl",
			coalesce(sum(summary."activeObjects"), 0)
				as "activeObjectChecks",
			coalesce(sum(summary."remoteFailureObjects" + ${retainedRemoteCountSql('summary."archiveUrlIdentity"')}), 0)
				as "archiveEvidenceFailures",
			coalesce(sum(summary."workerIssueObjects"), 0)
				as "scannerIssueFailures",
			coalesce(sum(
				summary."totalObjects"
				- summary."pendingObjects"
				- summary."activeObjects"
				- summary."verifiedObjects"
				- summary."remoteFailureObjects"
				- summary."workerIssueObjects"
			), 0) as "unclassifiedFailures"
		from source_aliases aliases
		left join history_archive_evidence_root_summary summary
			on summary."archiveUrlIdentity" = aliases."archiveUrlIdentity"
		group by aliases."archiveUrl"
	), checkpoint_proof as (
		select distinct on (aliases."archiveUrl")
			aliases."archiveUrl",
			proof."latestCheckpointLedger",
			proof."totalCheckpointProofs",
			coalesce(current_proof."pendingCheckpointProofs", 0)
				as "pendingCheckpointProofs",
			coalesce(current_proof."verifiedCheckpointProofs", 0)
				as "verifiedCheckpointProofs",
			coalesce(durable_proof."durableVerifiedCheckpointProofs", 0)
				as "durableVerifiedCheckpointProofs",
			coalesce(current_proof."mismatchCheckpointProofs", 0)
				as "mismatchCheckpointProofs",
			coalesce(current_proof."notEvaluableCheckpointProofs", 0)
				+ greatest(
					proof."totalCheckpointProofs"
						- coalesce(current_proof."totalCheckpointProofs", 0),
					0
				) as "notEvaluableCheckpointProofs",
			coalesce(current_proof."objectCompleteCheckpointProofs", 0)
				as "objectCompleteCheckpointProofs"
		from source_aliases aliases
		join history_archive_checkpoint_proof_rollup proof
			on proof."archiveUrlIdentity" = aliases."archiveUrlIdentity"
		left join history_archive_checkpoint_proof_version_rollup current_proof
			on current_proof."archiveUrlIdentity" = proof."archiveUrlIdentity"
			and current_proof."proofVersion" =
				${CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION}
		left join history_archive_checkpoint_proof_attestation_rollup durable_proof
			on durable_proof."archiveUrlIdentity" = proof."archiveUrlIdentity"
		order by
			aliases."archiveUrl",
			proof."latestCheckpointLedger" desc nulls last,
			proof."totalCheckpointProofs" desc,
			(proof."archiveUrlIdentity" = aliases."archiveUrl") desc,
			proof."archiveUrlIdentity"
	)
	select
		state."archiveUrl",
		state."archiveUrlIdentity",
		${activeListingGapCountSql('state."archiveUrlIdentity"')} as "listingGapCount",
		state."stateUrl",
		state.status as "stateStatus",
		state."observedAt",
		state.source,
		state."currentLedger",
		case
			when state."currentLedger" is null then null
			else (
				floor((greatest(state."currentLedger", 63) + 1)::numeric / 64)::integer
					* 64
			) - 1
		end as "latestCheckpointLedger",
		proof."latestCheckpointLedger" as "latestDiscoveredCheckpointLedger",
		coalesce(object_health."activeObjectChecks", 0) as "activeObjectChecks",
		coalesce(object_health."archiveEvidenceFailures", 0)
			as "archiveEvidenceFailures",
		coalesce(object_health."scannerIssueFailures", 0)
			as "scannerIssueFailures",
		coalesce(object_health."unclassifiedFailures", 0)
			as "unclassifiedFailures",
		coalesce(proof."totalCheckpointProofs", 0) as "totalCheckpointProofs",
		coalesce(proof."pendingCheckpointProofs", 0) as "pendingCheckpointProofs",
		coalesce(proof."verifiedCheckpointProofs", 0) as "verifiedCheckpointProofs",
		coalesce(proof."durableVerifiedCheckpointProofs", 0)
			as "durableVerifiedCheckpointProofs",
		coalesce(proof."mismatchCheckpointProofs", 0) as "mismatchCheckpointProofs",
		coalesce(proof."notEvaluableCheckpointProofs", 0)
			as "notEvaluableCheckpointProofs",
		coalesce(proof."objectCompleteCheckpointProofs", 0)
			as "objectCompleteCheckpointProofs",
		root_object."rootObjectStatus",
		root_object."rootFailureChannel"
	from current_state state
	left join root_object
		on root_object."archiveUrl" = state."archiveUrl"
	left join checkpoint_proof proof
		on proof."archiveUrl" = state."archiveUrl"
	left join object_health
		on object_health."archiveUrl" = state."archiveUrl"
	order by
		state.status asc,
		coalesce(state."currentLedger", -1) desc,
		state."archiveUrlIdentity" asc
	limit $1
`;
