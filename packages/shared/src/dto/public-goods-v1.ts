export type PublicGoodsCheckStatusV1 =
	'ready' | 'stale' | 'empty' | 'incomplete' | 'unavailable';

export interface PublicGoodsHealthCheckV1 {
	readonly status: PublicGoodsCheckStatusV1;
	readonly observedAt: string | null;
}

export interface PublicGoodsHealthV1 {
	readonly generatedAt: string;
	readonly status: 'ready' | 'not_ready';
	readonly checks: {
		readonly clickhouse: PublicGoodsHealthCheckV1;
		readonly publication: PublicGoodsHealthCheckV1 & {
			readonly latestCompletedAt: string | null;
		};
		readonly archive: PublicGoodsHealthCheckV1 & {
			readonly knownRoots: number | null;
			readonly checkedRoots: number | null;
			readonly checkedRootWindowHours: 24;
			readonly complete: boolean;
		};
	};
}

export interface PublicGoodsMetricsV1 {
	readonly generatedAt: string;
	readonly publication: {
		readonly observedAt: string | null;
		readonly configuredDatasets: number | null;
		/** Configured API datasets with nonzero active system.parts rows; not complete-history proof. */
		readonly publishedDatasets: number | null;
		readonly completedBatches: string | null;
		readonly failedBatches: string | null;
		readonly startedBatches: string | null;
		/** Exact projected row count from completed ingestion manifests (not unique source records). */
		readonly records: string | null;
		readonly latestCompletedAt: string | null;
		readonly maximumLedger: string | null;
	};
	readonly archives: {
		readonly observedAt: string | null;
		readonly knownRoots: number | null;
		/** Count of roots with source observations in the 24-hour check window. Null if inventory is truncated or unavailable. */
		readonly checkedRoots: number | null;
		readonly checkedRootWindowHours: 24;
		readonly rootObjectsVerified: number | null;
		readonly rootObjectsFailed: number | null;
		readonly oldestEvidenceAt: string | null;
		readonly newestEvidenceAt: string | null;
		readonly complete: boolean;
	};
}
