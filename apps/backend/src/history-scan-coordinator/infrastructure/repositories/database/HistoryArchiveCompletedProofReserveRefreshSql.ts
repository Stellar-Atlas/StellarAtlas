import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { historyArchiveCheckpointProofTerminalReadySql } from './HistoryArchiveCheckpointProofReadinessSql.js';

// Only newly completed, exact-source ledger evidence can reopen this proof.
export function historyArchiveCompletedProofReserveRefreshMemberSql(
	alias: string
): string {
	return `exists (
		select 1
		from "history_archive_checkpoint_proof" reserve_proof
		join "history_archive_object_queue" reserve_ledger
			on reserve_ledger."remoteId" = reserve_proof."ledgerObjectRemoteId"
			and reserve_ledger."archiveUrlIdentity" = reserve_proof."archiveUrlIdentity"
			and reserve_ledger."checkpointLedger" = reserve_proof."checkpointLedger"
			and reserve_ledger."objectType" = 'ledger'
			and reserve_ledger."executionReason" = 'proof-completion-reserve'
			and reserve_ledger.status = 'verified'
			and reserve_ledger."verificationFacts"#>>'{ledgerCategory,headerHashesVerified}' = 'true'
			and reserve_ledger."verifiedAt" > reserve_proof."evaluatedAt"
		where reserve_proof."archiveUrlIdentity" = ${alias}."archiveUrlIdentity"
			and reserve_proof."checkpointLedger" = ${alias}."checkpointLedger"
			and reserve_proof."proofVersion" = ${CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION}
			and reserve_proof.status = 'not-evaluable'
			and reserve_proof."failureKind" = 'proof-facts-incomplete'
			and reserve_proof."requiredObjectsComplete" = true
			and (
				reserve_proof."checkpointLedger" = 63
				or exists (
					select 1
					from "history_archive_checkpoint_proof" reserve_predecessor
					where reserve_predecessor."archiveUrlIdentity" = reserve_proof."archiveUrlIdentity"
						and reserve_predecessor."checkpointLedger" = reserve_proof."checkpointLedger" - 64
						and reserve_predecessor.status = 'verified'
				)
			)
	)`;
}

export const claimCompletedProofReserveRefreshSql = `
	with oldest_due as materialized (
		select queue."archiveUrlIdentity", queue."checkpointLedger"
		from history_archive_checkpoint_proof_refresh_queue queue
		where queue."refreshKind" = 'header-proof-repair'
			and queue."nextAttemptAt" <= now()
			and (queue."leaseUntil" is null or queue."leaseUntil" <= now())
		order by queue."nextAttemptAt", queue."requestedAt",
			queue."archiveUrlIdentity", queue."checkpointLedger"
		limit 128
	), candidate as materialized (
		select queue."archiveUrlIdentity", queue."checkpointLedger",
			eligible.evidence_updated_at
		from oldest_due due
		join history_archive_checkpoint_proof_refresh_queue queue
			on queue."archiveUrlIdentity" = due."archiveUrlIdentity"
			and queue."checkpointLedger" = due."checkpointLedger"
		cross join lateral (
			select greatest(ledger."verifiedAt",ledger."transitionEffectsRequiredAt")
				as evidence_updated_at
			from history_archive_checkpoint_proof proof
			join history_archive_object_queue ledger
				on ledger."remoteId"=proof."ledgerObjectRemoteId"
			where proof."archiveUrlIdentity"=queue."archiveUrlIdentity"
				and proof."checkpointLedger"=queue."checkpointLedger"
				and ${historyArchiveCompletedProofReserveRefreshMemberSql('queue')}
				and ${historyArchiveCheckpointProofTerminalReadySql('queue')}
			offset 0
		) eligible
		where queue."refreshKind" = 'header-proof-repair'
			and queue."nextAttemptAt" <= now()
			and (queue."leaseUntil" is null or queue."leaseUntil" <= now())
		order by queue."nextAttemptAt", queue."archiveUrlIdentity", queue."checkpointLedger"
		for update of queue skip locked
		limit 1
	), claimed as (
		update history_archive_checkpoint_proof_refresh_queue queue
		set "evidenceUpdatedAt" = greatest(queue."evidenceUpdatedAt",candidate.evidence_updated_at),
			generation = case when candidate.evidence_updated_at>queue."evidenceUpdatedAt"
				then queue.generation+1 else queue.generation end,
			attempts = case when candidate.evidence_updated_at>queue."evidenceUpdatedAt"
				then 0 else queue.attempts end,
			"lastError" = case when candidate.evidence_updated_at>queue."evidenceUpdatedAt"
				then null else queue."lastError" end,
			"leaseToken" = gen_random_uuid(),
			"leaseUntil" = now() + interval '2 minutes',
			"lastAttemptAt" = now(),
			"updatedAt" = now()
		from candidate
		where queue."archiveUrlIdentity" = candidate."archiveUrlIdentity"
			and queue."checkpointLedger" = candidate."checkpointLedger"
		returning queue.*
	)
	select "archiveUrlIdentity", "checkpointLedger",
		"evidenceUpdatedAt"::text as "evidenceUpdatedAt", generation, "leaseToken"
	from claimed
`;
