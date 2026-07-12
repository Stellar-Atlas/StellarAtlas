import type {
	HistoryArchiveObjectTypeV1,
	HistoryArchiveObjectV1
} from './history-archive-object-v1.js';
import type { HistoryArchiveObjectEvidenceClassV1 } from './history-archive-object-event-v1.js';
import type { HistoryArchiveStateSnapshotV1 } from './history-archive-state-v1.js';
import type {
	HistoryArchiveObjectEventPageV1,
	HistoryArchiveObjectPageV1
} from './history-archive-evidence-page-v1.js';

export interface KnownArchiveObjectCountsV1 {
	readonly activeObjects: number;
	readonly bucketObjects: number;
	readonly pendingObjects: number;
	readonly remoteFailureObjects: number;
	readonly totalObjects: number;
	readonly verifiedBucketObjects: number;
	readonly verifiedObjects: number;
	readonly workerIssueObjects: number;
}

export interface KnownArchiveCheckpointCountsV1 {
	readonly mismatchedCheckpoints: number;
	readonly notEvaluableCheckpoints: number;
	readonly pendingCheckpoints: number;
	readonly totalCheckpoints: number;
	readonly verifiedCheckpoints: number;
}

export interface KnownArchiveRootEvidenceV1 {
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
	readonly checkpoints: KnownArchiveCheckpointCountsV1;
	readonly latestObjectAt: string | null;
	readonly nodePublicKeys: readonly string[];
	readonly objects: KnownArchiveObjectCountsV1;
	readonly scannerOwnedState: HistoryArchiveStateSnapshotV1 | null;
}

export interface KnownArchiveVerifiedCopyV1 {
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
	readonly objectUrl: string;
	readonly remoteId: string;
	readonly verifiedAt: string | null;
}

export interface KnownArchiveVerifiedCopySetV1 {
	readonly copies: readonly KnownArchiveVerifiedCopyV1[];
	readonly count: number;
	readonly sampleLimit: number;
}

export interface KnownArchiveRemoteFailureV1 {
	readonly networkVerifiedCopies: KnownArchiveVerifiedCopySetV1;
	readonly object: HistoryArchiveObjectV1;
	readonly sameOrganizationVerifiedCopies: KnownArchiveVerifiedCopySetV1;
}

export interface KnownArchiveRemoteFailurePageV1 {
	readonly filters: KnownArchiveFailureFiltersV1;
	readonly failures: readonly KnownArchiveRemoteFailureV1[];
	readonly hasMore: boolean;
	readonly limit: number;
	readonly nextCursor: string | null;
	readonly snapshotAt: string;
	readonly total: number;
}

export type KnownArchiveInfrastructureEvidenceClassV1 = Exclude<
	HistoryArchiveObjectEvidenceClassV1,
	'archive-object'
>;

export interface KnownArchiveWorkerIssueV1 {
	readonly evidenceClass: KnownArchiveInfrastructureEvidenceClassV1;
	readonly object: HistoryArchiveObjectV1;
}

export interface KnownArchiveWorkerIssuePageV1 {
	readonly filters: KnownArchiveFailureFiltersV1;
	readonly hasMore: boolean;
	readonly issues: readonly KnownArchiveWorkerIssueV1[];
	readonly limit: number;
	readonly nextCursor: string | null;
	readonly snapshotAt: string;
	readonly total: number;
}

export interface KnownArchiveFailureFiltersV1 {
	readonly archiveUrlIdentity: string | null;
	readonly objectType: HistoryArchiveObjectTypeV1 | null;
}

export interface KnownArchiveEvidenceTotalsV1 {
	readonly archiveRoots: number;
	readonly checkpoints: KnownArchiveCheckpointCountsV1;
	readonly nodes: number;
	readonly objects: KnownArchiveObjectCountsV1;
}

export interface KnownArchiveEvidenceV1 {
	readonly eventPage: HistoryArchiveObjectEventPageV1;
	readonly generatedAt: string;
	readonly nodePublicKeys: readonly string[];
	readonly objectPage: HistoryArchiveObjectPageV1;
	readonly remoteFailures: KnownArchiveRemoteFailurePageV1;
	readonly roots: readonly KnownArchiveRootEvidenceV1[];
	readonly totals: KnownArchiveEvidenceTotalsV1;
	readonly workerIssues: KnownArchiveWorkerIssuePageV1;
}

export interface KnownNodeArchiveEvidenceV1 extends KnownArchiveEvidenceV1 {
	readonly organizationId: string | null;
	readonly publicKey: string;
}

export interface KnownOrganizationArchiveEvidenceV1 extends KnownArchiveEvidenceV1 {
	readonly organizationId: string;
}

export {
	KnownNodeArchiveEvidenceV1Schema,
	KnownOrganizationArchiveEvidenceV1Schema,
	KnownArchiveRootEvidenceV1Schema,
	KnownArchiveRemoteFailurePageV1Schema,
	KnownArchiveWorkerIssuePageV1Schema
} from './known-archive-evidence-v1-schema.js';
