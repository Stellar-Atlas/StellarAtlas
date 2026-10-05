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

function categoryLedgersSql(
	objectType: 'ledger' | 'transactions' | 'results'
): string {
	return `history_archive_category_ledgers(object."remoteId", object.attempts,
		'${objectType}', object."objectKey", object."checkpointLedger",
		object."objectUrl", object."verificationFacts")`;
}

export const ledgerFactsJsonSql = categoryLedgersSql('ledger');
export const transactionsFactsJsonSql = categoryLedgersSql('transactions');
export const resultsFactsJsonSql = categoryLedgersSql('results');
