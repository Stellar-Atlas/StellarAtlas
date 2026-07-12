import type { HistoryArchiveObject } from '../history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectEvidenceClass } from '../history-archive-object/HistoryArchiveObjectRetryPolicy.js';
import type { HistoryArchiveStateSnapshot } from '../history-archive-state/HistoryArchiveStateSnapshot.js';
import type { HistoryArchiveObjectEvent } from '../history-archive-object/HistoryArchiveObjectEvent.js';
import type {
	HistoryArchiveObjectEventPageFiltersV1,
	HistoryArchiveObjectPageFiltersV1,
	KnownArchiveCheckpointCountsV1,
	KnownArchiveFailureFiltersV1,
	KnownArchiveObjectCountsV1
} from 'shared';

export interface KnownArchiveRootScope {
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
}

export interface KnownArchiveEvidenceCursor {
	readonly remoteId: string;
	readonly at: Date;
}

export interface KnownArchiveEvidencePageRequest {
	readonly before: KnownArchiveEvidenceCursor | null;
	readonly limit: number;
	readonly snapshotAt: Date;
	readonly snapshotTotal: number | null;
}

export interface KnownArchiveObjectPageRequest extends KnownArchiveEvidencePageRequest {
	readonly filters: HistoryArchiveObjectPageFiltersV1;
}

export interface KnownArchiveObjectEventPageRequest extends KnownArchiveEvidencePageRequest {
	readonly filters: HistoryArchiveObjectEventPageFiltersV1;
}

export interface KnownArchiveFailurePageRequest extends KnownArchiveEvidencePageRequest {
	readonly filters: KnownArchiveFailureFiltersV1;
}

export interface KnownArchiveRootReadModel extends KnownArchiveRootScope {
	readonly checkpoints: KnownArchiveCheckpointCountsV1;
	readonly latestObjectAt: Date | null;
	readonly objects: KnownArchiveObjectCountsV1;
	readonly scannerOwnedState: HistoryArchiveStateSnapshot | null;
}

export interface KnownArchiveFailureReadModel {
	readonly evidenceClass: HistoryArchiveObjectEvidenceClass;
	readonly object: HistoryArchiveObject;
}

export type KnownArchiveVerifiedCopyRelation = 'same-organization' | 'network';

export interface KnownArchiveVerifiedCopyReadModel {
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
	readonly objectUrl: string;
	readonly remoteId: string;
	readonly verifiedAt: Date | null;
}

export interface KnownArchiveVerifiedCopySetReadModel {
	readonly copies: readonly KnownArchiveVerifiedCopyReadModel[];
	readonly count: number;
}

export interface KnownArchiveObjectCopyCoverageReadModel {
	readonly network: KnownArchiveVerifiedCopySetReadModel;
	readonly sameOrganization: KnownArchiveVerifiedCopySetReadModel;
	readonly sourceRemoteId: string;
}

export interface KnownArchiveEvidenceReadModel {
	readonly copyCoverage: readonly KnownArchiveObjectCopyCoverageReadModel[];
	readonly eventPage: {
		readonly events: readonly HistoryArchiveObjectEvent[];
		readonly total: number;
	};
	readonly objectPage: {
		readonly objects: readonly HistoryArchiveObject[];
		readonly total: number;
	};
	readonly remoteFailures: {
		readonly failures: readonly KnownArchiveFailureReadModel[];
		readonly total: number;
	};
	readonly roots: readonly KnownArchiveRootReadModel[];
	readonly workerIssues: {
		readonly failures: readonly KnownArchiveFailureReadModel[];
		readonly total: number;
	};
}

export interface KnownArchiveEvidenceQuery {
	readonly copyLimit: number;
	readonly eventPage: KnownArchiveObjectEventPageRequest;
	readonly objectPage: KnownArchiveObjectPageRequest;
	readonly remoteFailures: KnownArchiveFailurePageRequest;
	readonly roots: readonly KnownArchiveRootScope[];
	readonly sameOrganizationArchiveUrlIdentities: readonly string[];
	readonly snapshotAt: Date;
	readonly workerIssues: KnownArchiveFailurePageRequest;
}

export interface KnownArchiveEvidenceRepository {
	findEvidence(
		query: KnownArchiveEvidenceQuery
	): Promise<KnownArchiveEvidenceReadModel>;
}
