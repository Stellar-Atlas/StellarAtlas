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
	readonly hasError: boolean;
	readonly isSlowArchive: boolean;
	readonly latestScannedLedger: number;
	readonly latestVerifiedLedger: number;
	readonly startDate: string;
	readonly toLedger: number | null;
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

export interface ApiFailure {
	message: string;
	statusCode?: number;
}
