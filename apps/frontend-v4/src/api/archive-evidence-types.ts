import type {
	HistoryArchiveBucketCrossCoverageV1,
	HistoryArchiveEvidenceV2,
	HistoryArchiveObjectEventPageV1,
	HistoryArchiveObjectEventTypeV1,
	HistoryArchiveObjectEventsV1,
	HistoryArchiveObjectEvidenceClassV1,
	HistoryArchiveObjectPageV1,
	HistoryArchiveObjectQueueV1,
	HistoryArchiveObjectStatusV1,
	HistoryArchiveObjectSummaryV1,
	HistoryArchiveObjectTypeSummaryV1,
	HistoryArchiveObjectTypeV1,
	HistoryArchiveObjectV1,
	HistoryArchiveScanV1,
	HistoryArchiveStateSnapshotV1,
	KnownArchiveEvidenceV1,
	KnownArchiveRemoteFailurePageV1,
	KnownArchiveWorkerIssuePageV1,
	KnownNodeArchiveEvidenceV1,
	KnownOrganizationArchiveEvidenceV1
} from 'shared';

export type PublicHistoryArchiveScan = HistoryArchiveScanV1;
export type PublicHistoryArchiveEvidence = HistoryArchiveEvidenceV2;
export type PublicHistoryArchiveObject = HistoryArchiveObjectV1;
export type PublicHistoryArchiveBucketCrossCoverage =
	HistoryArchiveBucketCrossCoverageV1;
export type PublicHistoryArchiveObjectEvents = HistoryArchiveObjectEventsV1;
export type PublicHistoryArchiveObjectQueue = HistoryArchiveObjectQueueV1;
export type PublicHistoryArchiveObjectSummary = HistoryArchiveObjectSummaryV1;
export type PublicHistoryArchiveObjectTypeSummary =
	HistoryArchiveObjectTypeSummaryV1;
export type PublicHistoryArchiveState = HistoryArchiveStateSnapshotV1;
export type PublicHistoryArchiveObjectEventPage =
	HistoryArchiveObjectEventPageV1;
export type PublicHistoryArchiveObjectEvent =
	HistoryArchiveObjectEventPageV1['events'][number];
export type PublicHistoryArchiveObjectEventType =
	HistoryArchiveObjectEventTypeV1;
export type PublicHistoryArchiveObjectEvidenceClass =
	HistoryArchiveObjectEvidenceClassV1;
export type PublicHistoryArchiveObjectPage = HistoryArchiveObjectPageV1;
export type PublicHistoryArchiveObjectStatus = HistoryArchiveObjectStatusV1;
export type PublicHistoryArchiveObjectType = HistoryArchiveObjectTypeV1;
export type PublicKnownArchiveRemoteFailurePage =
	KnownArchiveRemoteFailurePageV1;
export type PublicKnownArchiveRemoteFailure =
	KnownArchiveRemoteFailurePageV1['failures'][number];
export type PublicKnownArchiveWorkerIssuePage = KnownArchiveWorkerIssuePageV1;
export type PublicKnownArchiveWorkerIssue =
	KnownArchiveWorkerIssuePageV1['issues'][number];
export type PublicKnownNodeArchiveEvidence = KnownNodeArchiveEvidenceV1;
export type PublicKnownOrganizationArchiveEvidence =
	KnownOrganizationArchiveEvidenceV1;
export type PublicKnownArchiveEvidence = KnownArchiveEvidenceV1;
export type PublicKnownArchiveRootEvidence =
	KnownNodeArchiveEvidenceV1['roots'][number];

export interface PublicHistoryArchiveScanLogError {
	readonly message: string;
	readonly type: string;
	readonly url: string;
}

export interface PublicHistoryArchiveScanLogEntry {
	readonly concurrency: number | null;
	readonly currentRangeFromLedger?: number | null;
	readonly currentRangeToLedger?: number | null;
	readonly durationMs: number;
	readonly endDate: string;
	readonly errors: readonly PublicHistoryArchiveScanLogError[];
	readonly fromLedger: number;
	readonly hasArchiveVerificationError?: boolean;
	readonly hasError: boolean;
	readonly hasWorkerIssue?: boolean;
	readonly isSlowArchive: boolean;
	readonly latestAttemptedLedger?: number | null;
	readonly latestScannedLedger: number;
	readonly latestVerifiedLedger: number;
	readonly startDate: string;
	readonly status: 'completed' | 'queued' | 'scanning' | 'starting' | 'stale';
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
