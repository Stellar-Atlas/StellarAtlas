export type ExplorerTransactionFeedFreshnessV1 = 'fresh' | 'stale' | 'unknown';

export type ExplorerTransactionFeedSelectionReasonV1 =
	| 'local_history_current'
	| 'local_history_empty'
	| 'local_history_behind'
	| 'live_network_unavailable';

export type ExplorerTransactionFeedSourceV1 = 'live_network' | 'local_history';

export interface ExplorerRecentTransactionV1 {
	readonly createdAt: string;
	readonly feeCharged: string;
	readonly hash: string;
	readonly ledger: string;
	readonly operationCount: number;
	readonly sourceAccount: string;
	readonly successful: boolean;
}

export interface ExplorerRecentTransactionsV1 {
	readonly dataThrough: string | null;
	readonly freshness: ExplorerTransactionFeedFreshnessV1;
	readonly freshnessThresholdMs: number;
	readonly generatedAt: string;
	readonly limit: number;
	readonly records: readonly ExplorerRecentTransactionV1[];
	readonly selectionReason: ExplorerTransactionFeedSelectionReasonV1;
	readonly source: ExplorerTransactionFeedSourceV1;
	readonly truncated: boolean;
}
