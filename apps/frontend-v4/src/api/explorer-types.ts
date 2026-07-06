export interface PublicExplorerLocalReadModel {
	readonly generatedAt: string;
	readonly indexes: {
		readonly assetIndexReady: false;
		readonly contractIndexReady: false;
		readonly operationIndexReady: false;
		readonly transactionIndexReady: false;
	};
	readonly parsedLedgerHeaders: {
		readonly earliestParsedLedger: string | null;
		readonly latestObservedAt: string | null;
		readonly latestParsedLedger: string | null;
		readonly latestParsedLedgerHash: string | null;
		readonly parsedLedgerCount: number;
		readonly sourceArchiveCount: number;
	};
	readonly source: 'parsed_ledger_header_repository';
	readonly transactions: {
		readonly localCoverage: false;
		readonly message: string;
		readonly source: 'horizon_fallback';
	};
}
