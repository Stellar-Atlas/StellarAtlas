import type {
	NetworkV1,
	NodeSnapshotV1,
	NodeV1,
	OrganizationSnapshotV1,
	OrganizationV1,
	ScpStatementObservationV1
} from 'shared';
import type { PublicHistoryArchiveScanLogError } from './archive-evidence-types';
export type * from './archive-evidence-types';
export type * from './known-network-types';
export type * from './search-types';
export type * from './worker-status-types';
export type { HistoryArchiveStatusSummaryV1 as PublicHistoryArchiveStatusSummary } from 'shared';

export type PublicNetwork = NetworkV1;
export type PublicNode = NodeV1;
export type PublicNodeSnapshot = NodeSnapshotV1;
export type PublicOrganization = OrganizationV1;
export type PublicOrganizationSnapshot = OrganizationSnapshotV1;
export type PublicScpStatementObservation = ScpStatementObservationV1;
export interface PublicScpGraphStatement {
	readonly nodeId: string;
	readonly observedAt: string;
	readonly observedFromPeer: string;
	readonly slotIndex: string;
	readonly statementHash: string;
	readonly statementType: ScpStatementObservationV1['statementType'];
	readonly values: readonly Pick<
		ScpStatementObservationV1['values'][number],
		'closeTime' | 'txSetHash'
	>[];
}
export type PublicScpStatementReadFreshness =
	'empty' | 'fresh' | 'stale' | 'unavailable';
export type PublicScpStatementReadSource = 'meilisearch' | 'postgres_canonical';

export interface PublicScpStatementReadMetadata {
	readonly freshness: PublicScpStatementReadFreshness;
	readonly freshnessMs: number | null;
	readonly observedAt: string | null;
	readonly source: PublicScpStatementReadSource;
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
	readonly source: 'horizon' | 'postgres_canonical';
}

export interface PublicRecentTransactions {
	readonly generatedAt: string;
	readonly limit: number;
	readonly records: readonly PublicTransactionLookup[];
	readonly source: 'horizon' | 'postgres_canonical';
	readonly truncated: boolean;
}

export interface PublicLedgerTransactions {
	readonly ledger: string;
	readonly records: readonly PublicLedgerTransaction[];
	readonly truncated: boolean;
}

export interface PublicLatestLedger {
	readonly closedAt: string;
	readonly freshness?: 'fresh' | 'stale';
	readonly freshnessMs?: number;
	readonly observedAt?: string;
	readonly protocolVersion: number | null;
	readonly sequence: string;
	readonly source?: 'horizon_fallback' | 'network_scan' | 'scp_live_collector';
}

export type PublicExplorerSource = 'horizon' | 'postgres_canonical' | 'rpc';
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

interface PublicExplorerOperationBase {
	readonly createdAt: string;
	readonly id: string;
	readonly ledger: string | null;
	readonly sourceAccount: string | null;
	readonly transactionHash: string | null;
	readonly type: string;
}

export interface PublicCanonicalExplorerOperation extends PublicExplorerOperationBase {
	readonly evidence: {
		readonly archiveSource: string;
		readonly batchId: string;
		readonly checkpointLedger: string;
		readonly checkpointProofId: number;
		readonly decoderVersion: string;
		readonly proofEvaluatedAt: string;
		readonly proofVersion: number;
	};
	readonly factScope: 'operation_body_and_envelope';
	readonly operationIndex: number;
	readonly outcomeAvailable: false;
	readonly source: 'postgres_canonical';
	readonly sourceAccountOrigin: 'operation' | 'transaction';
	readonly transactionIndex: number;
}

export interface PublicHorizonExplorerOperation extends PublicExplorerOperationBase {
	readonly source: 'horizon';
	readonly successful: boolean | null;
	readonly typeNumber: number | null;
}

export type PublicExplorerOperation =
	PublicCanonicalExplorerOperation | PublicHorizonExplorerOperation;

export interface PublicExplorerOperationFilters {
	readonly accountId?: string;
	readonly firstLedger?: string;
	readonly from?: string;
	readonly ledger?: string;
	readonly lastLedger?: string;
	readonly operationType?: string;
	readonly to?: string;
	readonly transactionHash?: string;
}

export interface PublicExplorerOperations {
	readonly count?: number;
	readonly coverage?: {
		readonly canonicalBatches: number;
		readonly complete: boolean;
		readonly firstIndexedLedger: string | null;
		readonly indexedBatches: number;
		readonly lastIndexedLedger: string | null;
	};
	readonly factBoundary?: {
		readonly includes: 'operation_type_and_effective_source';
		readonly outcomes: 'unavailable_without_ledger_close_meta';
	};
	readonly filters: PublicExplorerOperationFilters;
	readonly generatedAt?: string;
	readonly limit?: number;
	readonly records: readonly PublicExplorerOperation[];
	readonly source: 'horizon' | 'postgres_canonical';
	readonly truncated: boolean;
}

export interface PublicExplorerContract {
	readonly contractId: string;
	readonly message: string;
	readonly probe: 'not_run';
	readonly readiness: 'configured_not_probed' | 'planned';
	readonly source: 'rpc';
	readonly status: 'configured_not_probed' | 'loaded' | 'not_configured';
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

export type PublicStatusLevel = 'ok' | 'degraded' | 'unavailable';

export interface PublicFreshnessProbe {
	readonly ageMs: number | null;
	readonly latestAt: string | null;
	readonly staleAfterMs: number | null;
	readonly status: PublicStatusLevel;
}

export interface PublicArchiveEvidenceFreshnessProbe extends PublicFreshnessProbe {
	readonly deprecated?: true;
	readonly drivesPlatformStatus: false;
	readonly drivesRuntimeHealth: false;
	readonly source: 'archive_object_evidence';
}

export interface PublicLegacyArchiveScanFreshnessProbe extends PublicFreshnessProbe {
	readonly deprecated: true;
	readonly drivesPlatformStatus: false;
	readonly drivesRuntimeHealth: false;
	readonly historical: true;
	readonly source: 'legacy_range_scan';
}

export interface PublicDataFreshnessStatus {
	readonly archiveEvidence: PublicArchiveEvidenceFreshnessProbe;
	readonly archiveScan:
		| PublicLegacyArchiveScanFreshnessProbe
		| (PublicArchiveEvidenceFreshnessProbe & { readonly deprecated: true });
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

export interface PublicNetworkScanLogEntry {
	readonly archiveScheduling: PublicNetworkScanArchiveScheduling;
	readonly completed: boolean;
	readonly latestLedger: string;
	readonly latestLedgerCloseTime: string | null;
	readonly ledgersCount: number;
	readonly status: 'ok' | 'incomplete';
	readonly time: string;
}

export interface PublicNetworkScanArchiveScheduling {
	readonly discoveredArchiveUrlCount: number;
	readonly scheduledArchiveScanJobCount: number;
	readonly duplicateSuppressedArchiveScanJobCount: number;
	readonly schedulerErrorCount: number;
}

export type PublicArchiveScanLogConcurrency =
	number | null | 'pending' | 'unknown';

export interface PublicArchiveScanLogEntry {
	readonly concurrency: PublicArchiveScanLogConcurrency;
	readonly durationMs: number;
	readonly endDate: string;
	readonly errorCount: number;
	readonly errors: readonly PublicHistoryArchiveScanLogError[];
	readonly fromLedger: number;
	readonly hasArchiveVerificationError: boolean;
	readonly hasWorkerIssue: boolean;
	readonly latestAttemptedLedger?: number | null;
	readonly latestScannedLedger: number;
	readonly latestVerifiedLedger: number;
	readonly scanStatus: 'ok' | 'archive_error' | 'worker_issue';
	readonly startDate: string;
	readonly toLedger: number | null;
	readonly url: string;
}

export interface PublicScanLogStatus {
	readonly archiveScans: readonly PublicArchiveScanLogEntry[];
	readonly archiveScansDeprecated: true;
	readonly archiveScansHistorical: true;
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

export interface PublicConfiguredServiceStatus {
	readonly configured: boolean;
	readonly configurationState:
		'configured' | 'external_fallback' | 'not_configured';
	readonly generatedAt: string;
	readonly health: 'not_probed';
	readonly probe: 'not_run';
	readonly readiness: 'configured_not_probed' | 'external_fallback' | 'planned';
	readonly requiredForProduction: boolean;
	readonly service: 'frontend' | 'horizon' | 'rpc';
	readonly status: PublicStatusLevel;
	readonly url: string | null;
}

export interface PublicFullHistoryStatus {
	readonly canonicalCoverage: PublicCanonicalFullHistoryCoverage | null;
	readonly canonicalPromotion: PublicCanonicalFullHistoryPromotion | null;
	readonly earliestParsedLedger: string | null;
	readonly generatedAt: string;
	readonly historicalBackfill: PublicHistoricalFullHistoryBackfill | null;
	readonly latestObservedAt: string | null;
	readonly latestParsedLedger: string | null;
	readonly localAssetIndexReady: boolean;
	readonly localContractIndexReady: boolean;
	readonly localOperationIndexReady: boolean;
	readonly localTransactionIndexReady: boolean;
	readonly mode: 'archive_header_parser' | 'canonical_checkpoint_index';
	readonly parsedLedgerCount: number | null;
	readonly sourceArchiveCount: number | null;
	readonly status: PublicStatusLevel;
}

export interface PublicHistoricalFullHistoryBackfill {
	readonly failedJobs: number;
	readonly latestErrorCode: string | null;
	readonly nextCheckpointLedger: string | null;
	readonly pendingJobs: number;
	readonly runningJobs: number;
	readonly state:
		'complete' | 'failed' | 'idle' | 'queued' | 'running' | 'waiting-for-proof';
	readonly updatedAt: string | null;
}

export interface PublicCanonicalFullHistoryPromotion {
	readonly checkpointLedger: string | null;
	readonly heartbeatAt: string;
	readonly lastAttemptAt: string | null;
	readonly lastErrorCode: string | null;
	readonly lastFailureAt: string | null;
	readonly lastOutcome:
		'bootstrap-required' | 'proof-pending' | 'promoted' | 'replayed' | null;
	readonly lastSuccessAt: string | null;
	readonly nextLedger: string | null;
	readonly startedAt: string;
	readonly state:
		| 'failed'
		| 'promoting'
		| 'running'
		| 'stale'
		| 'stopped'
		| 'waiting-for-proof';
}

export interface PublicCanonicalFullHistoryCoverage {
	readonly archiveSourceCount: number;
	readonly batchCount: number;
	readonly firstLedger: string;
	readonly lastLedger: string;
	readonly latestLedgerClosedAt: string;
	readonly ledgerCount: number;
	readonly nextLedger: string;
	readonly rangeKind: 'contiguous_bounded';
	readonly source: 'postgres_canonical';
	readonly transactionCount: number;
	readonly transactionResultCount: number;
	readonly updatedAt: string;
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
