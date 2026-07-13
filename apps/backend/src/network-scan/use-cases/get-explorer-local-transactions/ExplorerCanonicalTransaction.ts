import type {
	FullHistoryCanonicalCoverageView,
	FullHistoryTransactionView
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalRepository.js';
import {
	mapCanonicalCoverage,
	type CanonicalFullHistoryCoverageDTO
} from '@history-scan-coordinator/use-cases/get-full-history-canonical-coverage/FullHistoryCanonicalCoverageDTO.js';

export type ExplorerCanonicalCoverageDTO = CanonicalFullHistoryCoverageDTO;

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
	return mapCanonicalCoverage(coverage);
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
