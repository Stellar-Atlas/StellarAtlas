import type { FullHistoryLedgerCloseMetaSha256Digest } from '../full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';

export interface FullHistoryLedgerProjection {
	readonly bucketListHash: string;
	readonly closedAtUnixMillis: string;
	readonly ledgerHash: string;
	readonly ledgerSequence: string;
	readonly previousLedgerHash: string;
	readonly protocolVersion: number;
	readonly transactionCount: string;
	readonly transactionResultSetHash: string;
	readonly transactionSetHash: string;
}

export interface FullHistoryStateCanonicalCoverageClaim {
	readonly attemptCount: number;
	readonly batchId: string;
	readonly endLedger: number;
	readonly expectedLedgerCount: number;
	readonly leaseOwner: string;
	readonly ledgerSourceSha256: FullHistoryLedgerCloseMetaSha256Digest;
	readonly networkPassphraseHash: FullHistoryLedgerCloseMetaSha256Digest;
	readonly startLedger: number;
	readonly storageKey: string;
}

export interface FullHistoryStateCanonicalCoverageReceipt {
	readonly batchId: string;
	readonly canonicalBatchCount: number;
	readonly ledgerCount: number;
	readonly minimumProofVersion: number;
	readonly status: 'complete' | 'mismatch';
}

export interface FullHistoryStateCanonicalCoverageRepository {
	claimNext(
		leaseOwner: string,
		leaseDurationMilliseconds: number
	): Promise<FullHistoryStateCanonicalCoverageClaim | null>;
	complete(
		claim: FullHistoryStateCanonicalCoverageClaim,
		exportedLedgerCount: bigint
	): Promise<FullHistoryStateCanonicalCoverageReceipt>;
	fail(
		claim: FullHistoryStateCanonicalCoverageClaim,
		error: Error
	): Promise<void>;
	registerPendingCoverage(): Promise<number>;
	renewLease(
		claim: FullHistoryStateCanonicalCoverageClaim,
		leaseDurationMilliseconds: number
	): Promise<void>;
	storeLedgerRows(
		claim: FullHistoryStateCanonicalCoverageClaim,
		rows: readonly FullHistoryLedgerProjection[]
	): Promise<void>;
}
