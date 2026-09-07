// One source anchor for a whole missing range; never synthesize per-file failures
// or successful proofs for bytes this archive did not serve.
export function historyArchiveListingGapAnchorSql(
	archiveIdentity: string,
	boundaryCheckpoint: string
): string {
	return `select source_proof.*
		from history_archive_listing_gap listing_gap
		join history_archive_state_snapshot target_state
			on target_state."archiveUrlIdentity" = listing_gap."archiveUrlIdentity"
		join history_archive_checkpoint_proof source_proof
			on source_proof.id = coalesce(listing_gap."sourceCheckpointProofId", (
				-- A source unavailable when the range was observed may become verified later.
				-- The checkpoint predicate is keyed; no per-file writes or whole-queue recovery.
				select late_proof.id
				from history_archive_checkpoint_proof late_proof
				join history_archive_state_snapshot late_state
					on late_state."archiveUrlIdentity" = late_proof."archiveUrlIdentity"
					and late_state.status = 'available'
					and late_state."networkPassphrase" = target_state."networkPassphrase"
				where listing_gap."sourceCheckpointProofId" is null
					and late_proof."checkpointLedger" = listing_gap."lastCheckpointLedger"
					and late_proof."archiveUrlIdentity" <> listing_gap."archiveUrlIdentity"
					and late_proof.status = 'verified'
					and late_proof."requiredObjectsComplete" = true
					and late_proof."proofFactsComplete" = true
					and late_proof."failureKind" is null
				order by late_proof."evaluatedAt", late_proof.id
				limit 1
			))
			and source_proof."checkpointLedger" = listing_gap."lastCheckpointLedger"
			and source_proof."archiveUrlIdentity" <> listing_gap."archiveUrlIdentity"
			and source_proof.status = 'verified'
			and source_proof."requiredObjectsComplete" = true
			and source_proof."proofFactsComplete" = true
			and source_proof."failureKind" is null
		join history_archive_state_snapshot source_state
			on source_state."archiveUrlIdentity" = source_proof."archiveUrlIdentity"
			and source_state.status = 'available'
			and source_state."networkPassphrase" = target_state."networkPassphrase"
		where listing_gap."archiveUrlIdentity" = ${archiveIdentity}
			and listing_gap."lastCheckpointLedger" = ${boundaryCheckpoint}
			and listing_gap."resolvedAt" is null
		order by listing_gap."observedAt" desc
		limit 1`;
}

export function historyArchiveListingGapResumeSql(
	archiveIdentity: string,
	nextCheckpoint: string,
	authorizedCheckpoint: string
): string {
	return `select gap."resumeCheckpointLedger"
		from history_archive_listing_gap gap
		cross join lateral (
			${historyArchiveListingGapAnchorSql('gap."archiveUrlIdentity"', 'gap."lastCheckpointLedger"')}
		) anchor
		where gap."archiveUrlIdentity" = ${archiveIdentity}
			and ${nextCheckpoint} between gap."firstCheckpointLedger" and gap."lastCheckpointLedger"
			and gap."resumeCheckpointLedger" <= ${authorizedCheckpoint}
			and gap."resolvedAt" is null
		order by gap."resumeCheckpointLedger" desc
		limit 1`;
}
