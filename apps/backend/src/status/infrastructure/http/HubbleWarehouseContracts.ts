import type {
	HubbleAccountTransactionQuery,
	HubbleAssetHolderPage,
	HubbleAssetHolderQuery,
	HubbleSemanticPage
} from './HubbleSemanticWarehouse.js';

export type HubbleFilterOperator =
	| 'contains'
	| 'eq'
	| 'gt'
	| 'gte'
	| 'in'
	| 'is_not_null'
	| 'is_null'
	| 'lt'
	| 'lte'
	| 'ne';

export interface HubbleFilter {
	readonly field: string;
	readonly operator?: HubbleFilterOperator;
	readonly value?: unknown;
	readonly values?: readonly unknown[];
}

export interface HubbleOrder {
	readonly direction?: 'asc' | 'desc';
	readonly field: string;
}

export interface HubbleQuery {
	readonly dataset: string;
	readonly filters?: readonly HubbleFilter[];
	readonly limit?: number;
	readonly offset?: number;
	readonly orderBy?: readonly HubbleOrder[];
	readonly select?: readonly string[];
}

export interface HubbleColumn {
	readonly name: string;
	readonly position: number;
	readonly type: string;
}

export interface HubbleDataset {
	readonly columns: readonly HubbleColumn[];
	readonly name: string;
	readonly rowCount: string;
}

export interface HubbleIngestionCoverage {
	readonly completedBatches: string;
	readonly failedBatches: string;
	readonly maximumLedger: string | null;
	readonly minimumLedger: string | null;
	readonly startedBatches: string;
	readonly totalRows: string;
}

export interface HubbleCatalog {
	readonly database: string;
	readonly datasets: readonly HubbleDataset[];
	readonly generatedAt: string;
	readonly ingestion: HubbleIngestionCoverage;
	readonly officialSchemaSource: string;
}

export interface HubbleQueryResult {
	readonly columns: readonly string[];
	readonly dataset: string;
	readonly elapsedMilliseconds: number;
	readonly limit: number;
	readonly offset: number;
	readonly rows: readonly Record<string, unknown>[];
}

export interface HubbleWarehouse {
	accountTransactions(
		query: HubbleAccountTransactionQuery
	): Promise<HubbleSemanticPage>;
	assetHolders(query: HubbleAssetHolderQuery): Promise<HubbleAssetHolderPage>;
	catalog(force?: boolean): Promise<HubbleCatalog>;
	query(query: HubbleQuery): Promise<HubbleQueryResult>;
}
