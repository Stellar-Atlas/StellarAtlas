export interface HistoryArchiveCheckpointStateFactV1 {
	readonly bucketListHash: string;
	readonly checkpointLedger: number;
	readonly networkPassphrase?: string;
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

export interface HistoryArchiveContentDigestFactV1 {
	readonly algorithm: 'sha256';
	readonly digest: string;
	readonly representation: 'canonical-json' | 'uncompressed-xdr';
}

export interface HistoryArchiveObjectVerificationFactsV1 {
	readonly bucketObject?: {
		readonly expectedBucketHash: string;
		readonly hashAlgorithm: 'sha256';
		readonly matched: true;
		readonly sourceUrl?: string;
	};
	readonly checkpointHistoryArchiveState?: object;
	readonly checkpointHistoryArchiveStateFact?: HistoryArchiveCheckpointStateFactV1;
	readonly content?: HistoryArchiveContentDigestFactV1;
	readonly ledgerCategory?: {
		readonly entryCount: number;
		readonly ledgers: readonly HistoryArchiveLedgerCategoryFactV1[];
		readonly sourceUrl?: string;
	};
	readonly resultsCategory?: {
		readonly entryCount: number;
		readonly ledgers: readonly HistoryArchiveCategoryHashFactV1[];
		readonly sourceUrl?: string;
	};
	readonly scpCategory?: {
		readonly entryCount: number;
		readonly sourceUrl?: string;
	};
	readonly transactionsCategory?: {
		readonly entryCount: number;
		readonly ledgers: readonly HistoryArchiveCategoryHashFactV1[];
		readonly sourceUrl?: string;
	};
}

export interface HistoryArchivePublicCategorySummaryV1 {
	readonly entryCount: number;
	readonly firstLedger: number | null;
	readonly lastLedger: number | null;
	readonly ledgerCount: number;
}

export interface HistoryArchivePublicVerificationFactsV1 {
	readonly bucketObject?: {
		readonly expectedBucketHash: string;
		readonly hashAlgorithm: 'sha256';
		readonly matched: true;
	};
	readonly checkpointHistoryArchiveStateFact?: {
		readonly bucketListHash: string;
		readonly checkpointLedger: number;
		readonly observedAt: string;
	};
	readonly content?: HistoryArchiveContentDigestFactV1;
	readonly ledgerCategory?: HistoryArchivePublicCategorySummaryV1;
	readonly resultsCategory?: HistoryArchivePublicCategorySummaryV1;
	readonly scpCategory?: { readonly entryCount: number };
	readonly transactionsCategory?: HistoryArchivePublicCategorySummaryV1;
}
