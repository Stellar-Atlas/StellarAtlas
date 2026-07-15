import type {
	FullHistoryAccountStateChange,
	FullHistoryStateDataset,
	FullHistoryTrustlineStateChange
} from './FullHistoryStateExport.js';
import type { FullHistoryLedgerCloseMetaSha256Digest } from '../full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';

export interface FullHistoryStateImportClaim {
	readonly batchId: string;
	readonly dataset: FullHistoryStateDataset;
	readonly endLedger: number;
	readonly expectedRecordCount: bigint;
	readonly leaseOwner: string;
	readonly sourceSha256: FullHistoryLedgerCloseMetaSha256Digest;
	readonly startLedger: number;
	readonly storageKey: string;
}

export interface FullHistoryStateImportRepository {
	claimNext(
		leaseOwner: string,
		leaseDurationMilliseconds: number
	): Promise<FullHistoryStateImportClaim | null>;
	complete(
		claim: FullHistoryStateImportClaim,
		exportedRecordCount: bigint
	): Promise<void>;
	fail(claim: FullHistoryStateImportClaim, error: Error): Promise<void>;
	registerPendingImports(): Promise<number>;
	renewLease(
		claim: FullHistoryStateImportClaim,
		leaseDurationMilliseconds: number
	): Promise<void>;
	storeAccountRows(
		claim: FullHistoryStateImportClaim,
		rows: readonly FullHistoryAccountStateChange[]
	): Promise<void>;
	storeTrustlineRows(
		claim: FullHistoryStateImportClaim,
		rows: readonly FullHistoryTrustlineStateChange[]
	): Promise<void>;
}

export interface FullHistoryStateImportReceipt {
	readonly batchId: string;
	readonly dataset: FullHistoryStateDataset;
	readonly recordCount: bigint;
}
