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

export type PublicKnownNodeMetadataState = 'snapshot' | 'public_key_only';

export interface PublicKnownNode {
	readonly current: boolean;
	readonly dateDiscovered: string;
	readonly lastMeasurementAt: string | null;
	readonly lastSeen: string | null;
	readonly metadataState: PublicKnownNodeMetadataState;
	readonly node: PublicNode | null;
	readonly publicKey: string;
	readonly snapshotEndDate: string | null;
	readonly snapshotStartDate: string | null;
}

export interface PublicKnownNodes {
	readonly count: number;
	readonly generatedAt: string;
	readonly nodes: readonly PublicKnownNode[];
}

export interface PublicKnownOrganization {
	readonly current: boolean;
	readonly lastMeasurementAt: string | null;
	readonly lastSeen: string | null;
	readonly organization: PublicOrganization;
	readonly snapshotEndDate: string | null;
	readonly snapshotStartDate: string;
}

export interface PublicKnownOrganizations {
	readonly count: number;
	readonly generatedAt: string;
	readonly organizations: readonly PublicKnownOrganization[];
}

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

export interface PublicHistoryArchiveScanEvidenceEntry {
	readonly bucketHash: string;
	readonly bucketUrl: string;
	readonly kind: 'bucket';
	readonly observedAt: string;
	readonly status: 'verified';
}

export interface PublicHistoryArchiveScanEvidence {
	readonly count: number;
	readonly evidence: readonly PublicHistoryArchiveScanEvidenceEntry[];
	readonly limit: number;
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

export interface PublicTransactionLookup extends PublicLedgerTransaction {
	readonly ledger: string;
	readonly source: 'horizon';
}

export interface PublicRecentTransactions {
	readonly generatedAt: string;
	readonly limit: number;
	readonly records: readonly PublicTransactionLookup[];
	readonly source: 'horizon';
	readonly truncated: boolean;
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

export type PublicExplorerSource = 'horizon' | 'rpc';
export type PublicExplorerSearchType =
	'account' | 'asset' | 'auto' | 'contract' | 'ledger' | 'transaction';

export interface PublicExplorerLedger {
	readonly closedAt: string;
	readonly hash: string;
	readonly operationCount: number;
	readonly protocolVersion: number;
	readonly sequence: string;
	readonly source: 'horizon';
	readonly transactionCount: number | null;
}

export interface PublicExplorerAccountBalance {
	readonly assetCode: string | null;
	readonly assetIssuer: string | null;
	readonly assetType: string;
	readonly balance: string;
}

export interface PublicExplorerAccount {
	readonly accountId: string;
	readonly balances: readonly PublicExplorerAccountBalance[];
	readonly lastModifiedLedger: string | null;
	readonly sequence: string;
	readonly source: 'horizon';
	readonly subentryCount: number;
}

export interface PublicExplorerAsset {
	readonly amount: string | null;
	readonly assetCode: string | null;
	readonly assetIssuer: string | null;
	readonly assetType: string;
	readonly numAccounts: number | null;
	readonly source: 'horizon';
}

export interface PublicExplorerAssets {
	readonly assets: readonly PublicExplorerAsset[];
	readonly source: 'horizon';
	readonly truncated: boolean;
}

export interface PublicExplorerOperation {
	readonly createdAt: string;
	readonly id: string;
	readonly ledger: string | null;
	readonly source: 'horizon';
	readonly sourceAccount: string | null;
	readonly successful: boolean | null;
	readonly transactionHash: string | null;
	readonly type: string;
	readonly typeNumber: number | null;
}

export interface PublicExplorerOperationFilters {
	readonly accountId?: string;
	readonly from?: string;
	readonly ledger?: string;
	readonly operationType?: string;
	readonly to?: string;
	readonly transactionHash?: string;
}

export interface PublicExplorerOperations {
	readonly filters: PublicExplorerOperationFilters;
	readonly records: readonly PublicExplorerOperation[];
	readonly source: 'horizon';
	readonly truncated: boolean;
}

export interface PublicExplorerContract {
	readonly contractId: string;
	readonly message: string;
	readonly source: 'rpc';
	readonly status: 'loaded' | 'unavailable' | 'unconfigured';
}

export interface PublicExplorerSearch {
	readonly query: string;
	readonly result:
		| PublicExplorerAccount
		| PublicExplorerAssets
		| PublicExplorerContract
		| PublicExplorerLedger
		| PublicExplorerOperation
		| PublicTransactionLookup
		| null;
	readonly resultType:
		| 'account'
		| 'asset'
		| 'contract'
		| 'ledger'
		| 'not_found'
		| 'transaction'
		| 'unknown';
	readonly source: PublicExplorerSource;
}

export type PublicSearchEntityType = 'node' | 'organization';
export type PublicSearchArchiveStatus = 'error' | 'ok' | 'unknown';
export type PublicSearchFacetName =
	| 'active'
	| 'archiveStatus'
	| 'countryCode'
	| 'entityType'
	| 'fullValidator'
	| 'topTier'
	| 'validating'
	| 'validator';

export interface PublicSearchHit {
	readonly detail: string;
	readonly entityId: string;
	readonly entityType: PublicSearchEntityType;
	readonly href: string;
	readonly id: string;
	readonly label: string;
	readonly organizationName?: string;
}

export interface PublicSearchFacetValue {
	readonly count: number;
	readonly value: string;
}

export type PublicSearchFacets = Record<
	PublicSearchFacetName,
	readonly PublicSearchFacetValue[]
>;

export interface PublicSearchResponse {
	readonly estimatedTotalHits: number;
	readonly facets: PublicSearchFacets;
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

export interface PublicArchiveScanWorker {
	readonly archiveUrl: string;
	readonly claimedAt: string;
	readonly concurrency: number | null;
	readonly fromLedger: number;
	readonly heartbeatAgeMs: number;
	readonly lastHeartbeatAt: string;
	readonly latestScannedLedger: number;
	readonly status: 'scanning' | 'starting' | 'stale';
	readonly toLedger: number | null;
}

export interface PublicArchiveScanWorkers {
	readonly activeWorkers: number;
	readonly generatedAt: string;
	readonly staleJobAgeMs: number;
	readonly staleWorkers: number;
	readonly totalTakenJobs: number;
	readonly workers: readonly PublicArchiveScanWorker[];
}

export interface PublicNetworkScanLogEntry {
	readonly completed: boolean;
	readonly latestLedger: string;
	readonly latestLedgerCloseTime: string | null;
	readonly ledgersCount: number;
	readonly status: 'ok' | 'incomplete';
	readonly time: string;
}

export interface PublicArchiveScanLogEntry {
	readonly concurrency: number;
	readonly durationMs: number;
	readonly endDate: string;
	readonly errorCount: number;
	readonly errors: readonly PublicHistoryArchiveScanLogError[];
	readonly fromLedger: number;
	readonly hasArchiveVerificationError: boolean;
	readonly hasWorkerIssue: boolean;
	readonly latestScannedLedger: number;
	readonly latestVerifiedLedger: number;
	readonly scanStatus: 'ok' | 'archive_error' | 'worker_issue';
	readonly startDate: string;
	readonly toLedger: number | null;
	readonly url: string;
}

export interface PublicScanLogStatus {
	readonly archiveScans: readonly PublicArchiveScanLogEntry[];
	readonly generatedAt: string;
	readonly limit: number;
	readonly networkScans: readonly PublicNetworkScanLogEntry[];
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
