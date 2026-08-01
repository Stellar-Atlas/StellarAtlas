import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';

export function currentProofFactCoverageSql(
	proofAlias: string,
	expectedLedgerCountSql: string
): string {
	return `
		${proofAlias}."ledgerFactCount" = ${expectedLedgerCountSql}
		and ${proofAlias}."transactionFactCount" between 0
			and ${expectedLedgerCountSql}
		and ${proofAlias}."resultFactCount" between 0
			and ${expectedLedgerCountSql}
	`;
}

export function compatibleProofFactCoverageSql(
	proofAlias: string,
	expectedLedgerCountSql: string
): string {
	return `
		${proofAlias}."ledgerFactCount" = ${expectedLedgerCountSql}
		and (
			(
				${proofAlias}."proofVersion" >=
					${CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION}
				and ${proofAlias}."transactionFactCount" between 0
					and ${expectedLedgerCountSql}
				and ${proofAlias}."resultFactCount" between 0
					and ${expectedLedgerCountSql}
			) or (
				${proofAlias}."proofVersion" <
					${CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION}
				and ${proofAlias}."transactionFactCount" =
					${expectedLedgerCountSql}
				and ${proofAlias}."resultFactCount" =
					${expectedLedgerCountSql}
			)
		)
	`;
}

export function legacyExactProofFactCoverageSql(
	proofAlias: string,
	expectedLedgerCountSql: string
): string {
	return `
		${proofAlias}."ledgerFactCount" = ${expectedLedgerCountSql}
		and ${proofAlias}."transactionFactCount" = ${expectedLedgerCountSql}
		and ${proofAlias}."resultFactCount" = ${expectedLedgerCountSql}
	`;
}
