import type { HistoryArchiveCheckpointProofRefreshTarget } from '@history-scan-coordinator/domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';

export function toHistoryArchiveCheckpointProofRefreshParams(
	target: HistoryArchiveCheckpointProofRefreshTarget
): readonly [string, number | null, string | null, boolean] {
	return [
		target.archiveUrlIdentity,
		target.checkpointLedger ?? null,
		target.bucketHash ?? null,
		target.includeSuccessor ?? false
	];
}

export const ledgerFactsJsonSql = `
	coalesce("verificationFacts"->'ledgerCategory'->'ledgers', '[]'::jsonb)
`;

export const transactionsFactsJsonSql = `
	coalesce("verificationFacts"->'transactionsCategory'->'ledgers', '[]'::jsonb)
`;

export const resultsFactsJsonSql = `
	coalesce("verificationFacts"->'resultsCategory'->'ledgers', '[]'::jsonb)
`;
