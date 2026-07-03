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
	readonly source: 'memory' | 'meilisearch';
}

export interface ApiFailure {
	message: string;
	statusCode?: number;
}
