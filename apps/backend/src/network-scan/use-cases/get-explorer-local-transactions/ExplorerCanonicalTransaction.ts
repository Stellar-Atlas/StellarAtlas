import type {
	FullHistoryCanonicalCoverageView,
	FullHistoryTransactionView
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalRepository.js';

export interface ExplorerCanonicalCoverageDTO {
	readonly archiveSourceCount: number;
	readonly batchCount: number;
	readonly firstLedger: string;
	readonly lastLedger: string;
	readonly latestLedgerClosedAt: string;
	readonly ledgerCount: number;
	readonly nextLedger: string;
	readonly rangeKind: 'contiguous_bounded';
	readonly transactionCount: number;
	readonly transactionResultCount: number;
	readonly updatedAt: string;
}

export interface ExplorerCanonicalTransactionDTO {
	readonly createdAt: string;
	readonly feeCharged: string;
	readonly hash: string;
	readonly ledger: string;
	readonly operationCount: number;
	readonly source: 'postgres_canonical';
	readonly sourceAccount: string;
	readonly successful: boolean;
}

export function mapExplorerCanonicalCoverage(
	coverage: FullHistoryCanonicalCoverageView
): ExplorerCanonicalCoverageDTO {
	return {
		archiveSourceCount: coverage.archiveSourceCount,
		batchCount: coverage.batchCount,
		firstLedger: coverage.firstLedger,
		lastLedger: coverage.lastLedger,
		latestLedgerClosedAt: coverage.latestLedgerClosedAt.toISOString(),
		ledgerCount: coverage.ledgerCount,
		nextLedger: coverage.nextLedger,
		rangeKind: 'contiguous_bounded',
		transactionCount: coverage.transactionCount,
		transactionResultCount: coverage.transactionResultCount,
		updatedAt: coverage.updatedAt.toISOString()
	};
}

export function mapExplorerCanonicalTransaction(
	transaction: FullHistoryTransactionView
): ExplorerCanonicalTransactionDTO {
	return {
		createdAt: transaction.closedAt.toISOString(),
		feeCharged: transaction.feeCharged,
		hash: transaction.transactionHash.toHex(),
		ledger: transaction.ledgerSequence,
		operationCount: transaction.operationCount,
		source: 'postgres_canonical',
		sourceAccount: transaction.sourceAccount,
		successful: transaction.successful
	};
}
