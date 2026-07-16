import type { EntityManager } from 'typeorm';
import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '@history-scan-coordinator/domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { canonicalRuntimeTargetCtes } from './HistoryArchiveCanonicalRuntimeTargetSql.js';
import { historyArchiveCheckpointProofRefreshSql } from './HistoryArchiveCheckpointProofRefreshSql.js';

interface StaleCanonicalProofRow {
	readonly archiveUrlIdentity: string;
	readonly checkpointLedger: number;
}

export async function refreshOneStaleCanonicalCheckpointProof(
	manager: EntityManager
): Promise<boolean> {
	const [target] = (await manager.query(staleCanonicalCheckpointProofSql, [
		CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION
	])) as readonly StaleCanonicalProofRow[];
	if (target === undefined) return false;

	await manager.query(historyArchiveCheckpointProofRefreshSql, [
		target.archiveUrlIdentity,
		target.checkpointLedger,
		null
	]);
	return true;
}

const staleCanonicalCheckpointProofSql = `
	with ${canonicalRuntimeTargetCtes}
	select proof."archiveUrlIdentity", proof."checkpointLedger"
	from runtime_target target
	join "history_archive_state_snapshot" state
		on state.status = 'available'
		and state."networkPassphrase" is not null
		and sha256(convert_to(state."networkPassphrase", 'UTF8')) =
			target."network_passphrase_hash"
	join "history_archive_checkpoint_proof" proof
		on proof."archiveUrlIdentity" = state."archiveUrlIdentity"
		and proof."checkpointLedger" = target.checkpoint_ledger
	where proof."proofVersion" < $1::integer
	order by
		(proof."missingBucketCount" = 0) desc,
		case proof."failureKind"
			when 'object-failed' then 0
			when 'proof-facts-incomplete' then 1
			else 2
		end,
		proof."requiredObjectsComplete" desc,
		proof."proofFactsComplete" desc,
		proof."verifiedBucketCount" desc,
		proof."evaluatedAt" desc,
		proof."archiveUrlIdentity"
	limit 1
`;
