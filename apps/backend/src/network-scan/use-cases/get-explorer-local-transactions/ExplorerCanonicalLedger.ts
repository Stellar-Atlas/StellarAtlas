import type { FullHistoryLedgerView } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalRepository.js';

export interface ExplorerCanonicalLedgerDTO {
	readonly closedAt: string;
	readonly hash: string;
	readonly operationCount: number;
	readonly protocolVersion: number;
	readonly sequence: string;
	readonly source: 'postgres_canonical';
	readonly transactionCount: number;
}

export function mapExplorerCanonicalLedger(
	ledger: FullHistoryLedgerView
): ExplorerCanonicalLedgerDTO {
	return {
		closedAt: ledger.closedAt.toISOString(),
		hash: ledger.ledgerHash.toHex(),
		operationCount: ledger.operationCount,
		protocolVersion: ledger.protocolVersion,
		sequence: ledger.ledgerSequence,
		source: 'postgres_canonical',
		transactionCount: ledger.transactionCount
	};
}
