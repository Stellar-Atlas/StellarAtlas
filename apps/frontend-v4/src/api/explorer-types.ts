export interface PublicExplorerLocalReadModel {
	readonly generatedAt: string;
	readonly indexes: {
		readonly assetIndexReady: false;
		readonly contractIndexReady: false;
		readonly operationIndexReady: boolean;
		readonly transactionIndexReady: boolean;
	};
	readonly parsedLedgerHeaders: {
		readonly earliestParsedLedger: string | null;
		readonly latestObservedAt: string | null;
		readonly latestParsedLedger: string | null;
		readonly latestParsedLedgerHash: string | null;
		readonly parsedLedgerCount: number;
		readonly sourceArchiveCount: number;
	};
	readonly source:
		'full_history_canonical_repository' | 'parsed_ledger_header_repository';
	readonly transactions: {
		readonly canonicalCoverage: PublicExplorerCanonicalCoverage | null;
		readonly localCoverage: boolean;
		readonly message: string;
		readonly source: 'horizon_fallback' | 'postgres_canonical';
	};
}

export interface PublicExplorerCanonicalCoverage {
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
