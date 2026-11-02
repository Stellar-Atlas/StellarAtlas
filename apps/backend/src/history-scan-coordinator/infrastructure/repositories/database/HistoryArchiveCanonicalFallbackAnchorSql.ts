import { getHistoryArchiveCanonicalFirstRoot } from './HistoryArchiveCanonicalFirst.js';

/** Canonical identity is independent of the optional exclusive scheduling gate. */
export function getCanonicalFallbackRoot(): string | null {
	const configured = process.env.HISTORY_ARCHIVE_CANONICAL_STATUS_ROOT;
	if (configured === undefined) return getHistoryArchiveCanonicalFirstRoot();
	return configured.trim().replace(/\/+$/, '') || null;
}

/** Resolve an authenticated canonical position, including a recorded fallback.
 * Referenced proof and ledger evidence are rechecked, not trusted by ID alone. */
export function canonicalVerifiedBoundarySql(canonicalSql: string, ledgerSql: string): string {
	return `select proof.* from (
		select direct.id, 0 as preference from history_archive_checkpoint_proof direct
		where direct."archiveUrlIdentity" = ${canonicalSql}
			and direct."checkpointLedger" = ${ledgerSql}
		union all
		select replacement."sourceCheckpointProofId", 1 as preference
		from history_archive_checkpoint_substitution replacement
		where replacement."archiveUrlIdentity" = ${canonicalSql}
			and replacement."checkpointLedger" = ${ledgerSql}
	) canonical_boundary_candidate
	join history_archive_checkpoint_proof proof on proof.id = canonical_boundary_candidate.id
	join history_archive_state_snapshot canonical_state
		on canonical_state."archiveUrlIdentity" = ${canonicalSql}
	join history_archive_state_snapshot source_state
		on source_state."archiveUrlIdentity" = proof."archiveUrlIdentity"
		and source_state."networkPassphrase" = canonical_state."networkPassphrase"
	join history_archive_object_queue boundary_object
		on boundary_object."remoteId" = proof."ledgerObjectRemoteId"
		and boundary_object."archiveUrlIdentity" = proof."archiveUrlIdentity"
		and boundary_object."checkpointLedger" = proof."checkpointLedger"
		and boundary_object."objectType" = 'ledger'
		and boundary_object.status = 'verified'
	where proof."checkpointLedger" = ${ledgerSql}
		and proof.status = 'verified'
		and proof."requiredObjectsComplete" and proof."proofFactsComplete"
		and proof."bucketsVerified" and proof."failedBucketCount" = 0
		and proof."failureKind" is null
	order by canonical_boundary_candidate.preference limit 1`;
}

/** A source-local download is not a source-local history chain. Only explicitly
 * admitted canonical fallback checkpoints may inherit this authenticated boundary.
 * Keep the admission marker durable so later reconciliation uses the same anchor
 * after the forward cursor has moved. The evaluator still checks the header hash.
 */
export function canonicalFallbackPredecessorSql(
	archiveIdentitySql: string,
	checkpointSql: string,
	canonicalRootSql?: string
): string {
	const root = getCanonicalFallbackRoot();
	const canonical = canonicalRootSql ??
		(root === null ? 'null::text' : `'${root.replaceAll("'", "''")}'::text`);
	return `select proof.*
		from lateral (${canonicalVerifiedBoundarySql(canonical, checkpointSql + ' - 64')}) proof
		join history_archive_state_snapshot canonical_state
			on canonical_state."archiveUrlIdentity" = ${canonical}
		join history_archive_state_snapshot alternate_state
			on alternate_state."archiveUrlIdentity" = ${archiveIdentitySql}
			and alternate_state."networkPassphrase" = canonical_state."networkPassphrase"
		where ${canonical} is not null
			and ${canonical} <> ${archiveIdentitySql}
			and exists (
				select 1 from history_archive_object_queue admission
				where admission."archiveUrlIdentity" = ${archiveIdentitySql}
					and admission."checkpointLedger" = ${checkpointSql}
					and admission."objectType" = 'checkpoint-state'
					and admission."executionReason" = 'canonical-frontier-alternate'
			)
		limit 1`;
}
