export interface HistoryArchiveCheckpointStateFactV1 {
	readonly bucketListHash: string;
	readonly checkpointLedger: number;
	readonly observedAt: string;
	readonly stellarHistoryUrl: string;
}

export interface HistoryArchiveLedgerCategoryFactV1 {
	readonly bucketListHash: string;
	readonly ledger: number;
	readonly ledgerHeaderHash: string | null;
	readonly previousLedgerHeaderHash: string;
	readonly protocolVersion: number | null;
	readonly transactionResultSetHash: string;
	readonly transactionSetHash: string;
}

export interface HistoryArchiveCategoryHashFactV1 {
	readonly hash: string;
	readonly ledger: number;
}

export interface HistoryArchiveObjectVerificationFactsV1 {
	readonly bucketObject?: {
		readonly expectedBucketHash: string;
		readonly hashAlgorithm: 'sha256';
		readonly matched: true;
	};
	readonly checkpointHistoryArchiveState?: object;
	readonly checkpointHistoryArchiveStateFact?: HistoryArchiveCheckpointStateFactV1;
	readonly ledgerCategory?: {
		readonly entryCount: number;
		readonly ledgers: readonly HistoryArchiveLedgerCategoryFactV1[];
	};
	readonly resultsCategory?: {
		readonly entryCount: number;
		readonly ledgers: readonly HistoryArchiveCategoryHashFactV1[];
	};
	readonly scpCategory?: {
		readonly entryCount: number;
	};
	readonly transactionsCategory?: {
		readonly entryCount: number;
		readonly ledgers: readonly HistoryArchiveCategoryHashFactV1[];
	};
}
