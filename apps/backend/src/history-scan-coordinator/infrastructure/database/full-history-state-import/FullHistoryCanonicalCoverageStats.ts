import type { EntityManager } from 'typeorm';
import type { FullHistoryStateCanonicalCoverageClaim } from '../../../domain/full-history-state-import/FullHistoryLedgerProjection.js';

export interface FullHistoryCanonicalCoverageStats {
	readonly canonicalBatchCount: number;
	readonly latestProofEvaluatedAt: Date | null;
	readonly matchingCount: number;
	readonly minimumProofVersion: number | null;
	readonly projectionCount: number;
}

export async function readFullHistoryCanonicalCoverageStats(
	manager: EntityManager,
	claim: FullHistoryStateCanonicalCoverageClaim
): Promise<FullHistoryCanonicalCoverageStats> {
	const rows = await manager.query<FullHistoryCanonicalCoverageStats[]>(
		`select count(*)::integer as "projectionCount",
			count(*) filter (where canonical."ledger_sequence" is not null
				and proof."proof_version" >= 6
				and projection."ledger_hash" = canonical."ledger_hash"
				and projection."previous_ledger_hash" = canonical."previous_ledger_hash"
				and projection."transaction_set_hash" = canonical."transaction_set_hash"
				and projection."transaction_result_hash" = canonical."transaction_result_hash"
				and projection."bucket_list_hash" = canonical."bucket_list_hash"
				and projection."protocol_version" = canonical."protocol_version"
				and projection."closed_at" = canonical."closed_at"
				and projection."transaction_count" = canonical."transaction_count")::integer
				as "matchingCount",
			min(proof."proof_version") as "minimumProofVersion",
			max(proof."proof_evaluated_at") as "latestProofEvaluatedAt",
			count(distinct canonical."batch_id")::integer as "canonicalBatchCount"
		 from "full_history_lcm_ledger_projection" projection
		 left join "full_history_ledger" canonical
			on canonical."network_passphrase_hash" = $2
			and canonical."ledger_sequence" = projection."ledger_sequence"
		 left join "full_history_ingestion_batch" proof
			on proof."id" = canonical."batch_id"
			and proof."network_passphrase_hash" = canonical."network_passphrase_hash"
		 where projection."batch_id" = $1`,
		[claim.batchId, Buffer.from(claim.networkPassphraseHash, 'hex')]
	);
	if (rows.length !== 1) {
		throw new Error('Expected one canonical coverage stats row');
	}
	return rows[0]!;
}
