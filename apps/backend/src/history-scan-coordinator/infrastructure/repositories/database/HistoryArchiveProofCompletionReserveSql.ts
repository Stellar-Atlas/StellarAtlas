import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';

// Cohort membership only. Mutable eligibility and outer admission guards remain
// authoritative; this never opens ordinary historical retries or bucket work.
export function historyArchiveProofCompletionReserveMemberSql(
	alias: string
): string {
	return `(
		${alias}."executionReason" = 'proof-completion-reserve'
		and ${alias}."objectType" = 'ledger'
		and coalesce(
			${alias}."verificationFacts"#>>'{ledgerCategory,headerHashesVerified}',
			'false'
		) <> 'true'
		and exists (
			select 1
			from "history_archive_checkpoint_proof" reserve_proof
			where reserve_proof."archiveUrlIdentity" = ${alias}."archiveUrlIdentity"
				and reserve_proof."checkpointLedger" = ${alias}."checkpointLedger"
				and reserve_proof."ledgerObjectRemoteId" = ${alias}."remoteId"
				and reserve_proof."proofVersion" = ${CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION}
				and reserve_proof.status = 'not-evaluable'
				and reserve_proof."failureKind" = 'proof-facts-incomplete'
				and reserve_proof."requiredObjectsComplete" = true
				and (
					reserve_proof."checkpointLedger" = 63
					or exists (
						select 1
						from "history_archive_checkpoint_proof" reserve_predecessor
						where reserve_predecessor."archiveUrlIdentity" =
							reserve_proof."archiveUrlIdentity"
							and reserve_predecessor."checkpointLedger" =
								reserve_proof."checkpointLedger" - 64
							and reserve_predecessor.status = 'verified'
					)
				)
		)
	)`;
}
