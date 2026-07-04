import type {
	NetworkV1,
	NodeSnapshotV1,
	NodeV1,
	OrganizationSnapshotV1,
	OrganizationV1,
	HistoryArchiveScanV1,
	ScpStatementObservationV1
} from 'shared';

export type PublicNetwork = NetworkV1;
export type PublicNode = NodeV1;
export type PublicNodeSnapshot = NodeSnapshotV1;
export type PublicOrganization = OrganizationV1;
export type PublicOrganizationSnapshot = OrganizationSnapshotV1;
export type PublicHistoryArchiveScan = HistoryArchiveScanV1;
export type PublicScpStatementObservation = ScpStatementObservationV1;

export interface PublicHistoryArchiveScanLogError {
	readonly message: string;
	readonly type: string;
	readonly url: string;
}

export interface PublicHistoryArchiveScanLogEntry {
	readonly concurrency: number;
	readonly durationMs: number;
	readonly endDate: string;
	readonly errors: readonly PublicHistoryArchiveScanLogError[];
	readonly fromLedger: number;
	readonly hasArchiveVerificationError?: boolean;
	readonly hasError: boolean;
	readonly hasWorkerIssue?: boolean;
	readonly isSlowArchive: boolean;
	readonly latestScannedLedger: number;
	readonly latestVerifiedLedger: number;
	readonly startDate: string;
	readonly status: 'completed' | 'queued' | 'scanning' | 'stale';
	readonly toLedger: number | null;
	readonly updatedAt: string;
	readonly url: string;
}

export interface PublicLedgerTransaction {
	readonly createdAt: string;
	readonly feeCharged: string;
	readonly hash: string;
	readonly operationCount: number;
	readonly sourceAccount: string;
	readonly successful: boolean;
}

export interface PublicLedgerTransactions {
	readonly ledger: string;
	readonly records: readonly PublicLedgerTransaction[];
	readonly truncated: boolean;
}

export interface PublicLatestLedger {
	readonly closedAt: string;
	readonly protocolVersion: number;
	readonly sequence: string;
}

export type PublicSearchEntityType = 'node' | 'organization';

export interface PublicSearchHit {
	readonly detail: string;
	readonly entityId: string;
	readonly entityType: PublicSearchEntityType;
	readonly href: string;
	readonly id: string;
	readonly label: string;
	readonly organizationName?: string;
}

export interface PublicSearchResponse {
	readonly estimatedTotalHits: number;
	readonly hits: readonly PublicSearchHit[];
	readonly indexedNetworkTime: string;
	readonly query: string;
	readonly readModel: {
		readonly fallbackReason:
			| 'meilisearch_syncing'
			| 'meilisearch_unavailable'
			| 'meilisearch_unconfigured'
			| null;
		readonly schemaVersion: string;
	};
	readonly source: 'memory' | 'meilisearch';
}

export type PublicStatusLevel = 'ok' | 'degraded' | 'unavailable';

export interface PublicFreshnessProbe {
	readonly ageMs: number | null;
	readonly latestAt: string | null;
	readonly staleAfterMs: number | null;
	readonly status: PublicStatusLevel;
}

export interface PublicDataFreshnessStatus {
	readonly archiveScan: PublicFreshnessProbe;
	readonly generatedAt: string;
	readonly networkScan: PublicFreshnessProbe;
	readonly status: PublicStatusLevel;
}

export interface PublicScanContinuityStatus {
	readonly generatedAt: string;
	readonly networkScan: {
		readonly completedScans: number;
		readonly completionRate: number | null;
		readonly expectedCompletionRate: number | null;
		readonly expectedScans: number;
		readonly incompleteScans: number;
		readonly latestCompletedScanAt: string | null;
		readonly latestScanAt: string | null;
		readonly scanIntervalMs: number;
		readonly status: PublicStatusLevel;
		readonly totalScans: number;
		readonly windowEnd: string;
		readonly windowMs: number;
		readonly windowStart: string;
	};
	readonly status: PublicStatusLevel;
}

export interface PublicRollupStatus {
	readonly generatedAt: string;
	readonly networkRollups: {
		readonly daysWithCompletedScans: number;
		readonly daysWithRollups: number;
		readonly latestRollupDay: string | null;
		readonly matchingDays: number;
		readonly mismatchedRollupDays: number;
		readonly missingRollupDays: number;
		readonly rawCompletedScans: number;
		readonly rollupCrawlCount: number;
		readonly status: PublicStatusLevel;
		readonly windowDays: number;
		readonly windowEnd: string;
		readonly windowStart: string;
	};
	readonly status: PublicStatusLevel;
}

export interface PublicArchiveQueueStatus {
	readonly activeJobs: number;
	readonly generatedAt: string;
	readonly pendingJobs: number;
	readonly staleJobAgeMs: number;
	readonly staleJobs: number;
	readonly status: PublicStatusLevel;
	readonly totalUnfinishedJobs: number;
}

export interface PublicDataQualityStatus {
	readonly archiveQueue: PublicArchiveQueueStatus;
	readonly dataFreshness: PublicDataFreshnessStatus;
	readonly generatedAt: string;
	readonly rollups: PublicRollupStatus;
	readonly scans: PublicScanContinuityStatus;
	readonly status: PublicStatusLevel;
}

export interface PublicApiStatus {
	readonly generatedAt: string;
	readonly service: 'api';
	readonly status: PublicStatusLevel;
}

export interface PublicWorkerStatus {
	readonly archiveWorkers: {
		readonly activeWorkers: number;
		readonly staleJobAgeMs: number;
		readonly staleWorkers: number;
		readonly status: PublicStatusLevel;
		readonly totalTakenJobs: number;
	};
	readonly communityScanners: {
		readonly activeScanners: number;
		readonly blacklistedScanners: number;
		readonly degradedScanners: number;
		readonly heartbeatFreshnessMs: number;
		readonly offlineScanners: number;
		readonly status: PublicStatusLevel;
		readonly totalScanners: number;
	};
	readonly generatedAt: string;
	readonly status: PublicStatusLevel;
}

export interface PublicConfiguredServiceStatus {
	readonly configured: boolean;
	readonly generatedAt: string;
	readonly probe: 'not_run';
	readonly service: 'frontend' | 'horizon' | 'rpc';
	readonly status: PublicStatusLevel;
	readonly url: string | null;
}

export interface PublicFailoverStatus {
	readonly apiUrl: string | null;
	readonly complete: boolean;
	readonly configured: boolean;
	readonly frontendUrl: string | null;
	readonly generatedAt: string;
	readonly probe: 'not_run';
	readonly service: 'failover';
	readonly status: PublicStatusLevel;
}

export interface ApiFailure {
	message: string;
	statusCode?: number;
}
