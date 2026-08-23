import type { HistoryArchiveObject } from './HistoryArchiveObject.js';
import type { HistoryArchiveObjectType } from './HistoryArchiveObject.js';
import type { HistoryArchiveObjectVerificationFacts } from './HistoryArchiveObject.js';
import type {
	HistoryArchiveObjectEvidenceClass,
	HistoryArchiveObjectFailureClass
} from './HistoryArchiveObjectRetryPolicy.js';
import type {
	HistoryArchiveObjectRecheckBlockedReasonV1,
	HistoryArchiveObjectHostThrottleV1,
	HistoryArchiveObjectSummaryV1,
	HistoryArchiveContentReuseV1,
	HistoryArchiveStatusSummaryV1
} from 'shared';
import type {
	ArchiveMetadataDTO,
	HistoryArchiveObjectFailureChannelDTO
} from 'history-scanner-dto';

export interface HistoryArchiveObjectQueueStats {
	readonly activeObjects: number;
	readonly failedObjects: number;
	readonly pendingObjects: number;
	readonly verifiedObjects: number;
}

export interface HistoryArchiveObjectQueueSnapshot extends HistoryArchiveObjectQueueStats {
	readonly objects: readonly HistoryArchiveObject[];
}

export interface HistoryArchiveRepairPlanSummary {
	readonly activeObjects: number;
	readonly failedCheckpointProofs: number;
	readonly failedObjects: number;
	readonly hostThrottles: readonly HistoryArchiveObjectHostThrottleV1[];
	readonly pendingObjects: number;
	readonly verifiedObjects: number;
}

export interface HistoryArchiveVerifiedBucketSource {
	readonly anchorKind: 'content-addressed-bucket';
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
	readonly bucketHash: string;
	readonly candidateRemoteId: string;
	readonly checkpointLedger: number;
	readonly contentDigest: string;
	readonly contentRepresentation: 'uncompressed-xdr';
	readonly objectUrl: string;
	readonly proofEvaluatedAt: Date;
	readonly proofId: number;
	readonly proofVersion: number;
	readonly corroboratingSourceCount: number;
	readonly targetRemoteId: string;
	readonly verifiedAt: Date;
}

export interface HistoryArchiveVerifiedCheckpointObjectSource {
	readonly anchorKind: 'multi-source' | 'target-digest';
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
	readonly candidateRemoteId: string;
	readonly checkpointLedger: number;
	readonly contentDigest: string;
	readonly contentRepresentation: 'canonical-json' | 'uncompressed-xdr';
	readonly objectUrl: string;
	readonly proofEvaluatedAt: Date;
	readonly proofId: number;
	readonly proofVersion: number;
	readonly corroboratingSourceCount: number;
	readonly targetRemoteId: string;
	readonly verifiedAt: Date;
}

export interface HistoryArchiveObjectWorkerSnapshot {
	readonly activeObjects: number;
	readonly hasPendingObjects: boolean;
	readonly staleObjects: number;
	readonly totalScanningObjects: number;
}

export interface HistoryArchiveObjectProgressUpdate {
	readonly archiveMetadata?: ArchiveMetadataDTO | null;
	readonly bytesDownloaded?: number | null;
	readonly claimAttempt: number;
	readonly contentReuse?: HistoryArchiveContentReuseV1;
	readonly verificationFacts?: HistoryArchiveObjectVerificationFacts | null;
	readonly workerStage?: string | null;
	readonly executionId?: string;
	readonly scheduler?: 'broker' | 'legacy';
}

export interface HistoryArchiveObjectVerificationUpdate {
	readonly remoteId: string;
	readonly progress: HistoryArchiveObjectProgressUpdate;
}

export interface HistoryArchiveObjectFailure {
	readonly claimAttempt: number;
	readonly errorMessage: string;
	readonly errorType: string;
	readonly failureChannel: HistoryArchiveObjectFailureChannelDTO;
	readonly httpStatus?: number | null;
	readonly nextAttemptAt?: Date | null;
	readonly retryAfterSeconds?: number | null;
	readonly verificationFacts?: HistoryArchiveObjectVerificationFacts | null;
	readonly executionId?: string;
	readonly scheduler?: 'broker' | 'legacy';
}

export interface HistoryArchiveObjectHostFailure {
	readonly archiveUrlIdentity: string;
	readonly blockedUntil: Date;
	readonly errorType: string;
	readonly evidenceClass: HistoryArchiveObjectEvidenceClass;
	readonly failureClass: HistoryArchiveObjectFailureClass;
	readonly hostIdentity: string;
	readonly httpStatus?: number | null;
	readonly retryAfterUntil?: Date | null;
}

export interface HistoryArchiveObjectPlanPromotionResult {
	readonly availableSlots: number;
	readonly outstandingObjects: number;
	readonly promotedObjects: number;
	readonly recentCompletions: number;
	readonly watermark: number;
}

export interface HistoryArchiveObjectExecutionReconciliationResult {
	readonly admittedObjects: number;
	readonly availableSlots: number;
	readonly cursorAdvances: number;
	readonly outstandingObjects: number;
	readonly preservedObjects: number;
	readonly recentCompletions: number;
	readonly watermark: number;
}

export interface HistoryArchiveCheckpointProofRefreshDrainResult {
	readonly claimed: number;
	readonly completed: number;
	readonly failed: number;
}

export type HistoryArchiveCheckpointProofRefreshPriority = 0 | 1;

interface HistoryArchiveObjectRecheckDecisionBase {
	readonly blockedUntil: Date | null;
	readonly eligibleAt: Date | null;
	readonly remoteId: string;
}

export type HistoryArchiveObjectRecheckDecision =
	| (HistoryArchiveObjectRecheckDecisionBase & {
			readonly reason: 'eligible-remote-failure';
			readonly state: 'queued';
	  })
	| (HistoryArchiveObjectRecheckDecisionBase & {
			readonly reason: 'already-in-ready-queue';
			readonly state: 'already-queued';
	  })
	| (HistoryArchiveObjectRecheckDecisionBase & {
			readonly reason: 'retry-window';
			readonly state: 'not-yet-eligible';
	  })
	| (HistoryArchiveObjectRecheckDecisionBase & {
			readonly reason: HistoryArchiveObjectRecheckBlockedReasonV1;
			readonly state: 'blocked';
	  });

export interface HistoryArchiveObjectRepository {
	drainCheckpointProofRefreshQueue(
		limit: number,
		maximumPriority: HistoryArchiveCheckpointProofRefreshPriority
	): Promise<HistoryArchiveCheckpointProofRefreshDrainResult>;
	enqueueCheckpointProofRefreshes(
		remoteIds: readonly string[]
	): Promise<number>;
	claimNextObject(
		supportedTypes: readonly HistoryArchiveObjectType[]
	): Promise<HistoryArchiveObject | null>;
	findActionableByArchiveUrl(
		archiveUrl: string,
		limit: number
	): Promise<readonly HistoryArchiveObject[]>;
	findByArchiveUrl(
		archiveUrl: string,
		limit: number
	): Promise<HistoryArchiveObjectQueueSnapshot>;
	findBucketObjectsByHash(
		bucketHash: string
	): Promise<readonly HistoryArchiveObject[]>;
	findVerifiedBucketSourcesByRemoteIds(
		targetRemoteIds: readonly string[],
		limitPerObject: number
	): Promise<readonly HistoryArchiveVerifiedBucketSource[]>;
	findVerifiedCheckpointObjectSources(
		targetRemoteIds: readonly string[],
		limitPerObject: number
	): Promise<readonly HistoryArchiveVerifiedCheckpointObjectSource[]>;
	findByRemoteId(remoteId: string): Promise<HistoryArchiveObject | null>;
	findLatestActivityAt(): Promise<Date | null>;
	findByRemoteIds(
		remoteIds: readonly string[]
	): Promise<readonly HistoryArchiveObject[]>;
	findUnreconciledTransitions(
		limit: number
	): Promise<readonly HistoryArchiveObject[]>;
	findVerifiedCheckpointsNeedingReconciliation(
		limit: number
	): Promise<readonly HistoryArchiveObject[]>;
	findVerifiedCheckpointsNeedingFanout(
		limit: number
	): Promise<readonly HistoryArchiveObject[]>;
	markCheckpointDescendantsPlanned(remoteId: string): Promise<boolean>;
	markCheckpointDescendantsPlannedBatch(
		remoteIds: readonly string[]
	): Promise<number>;
	findOldestCheckpointLedgerByArchiveUrlIdentities(
		archiveUrlIdentities: readonly string[]
	): Promise<ReadonlyMap<string, number>>;
	findVerifiedBucketObjectsByArchiveUrl(
		archiveUrl: string,
		limit: number
	): Promise<readonly HistoryArchiveObject[]>;
	getQueueSnapshot(limit: number): Promise<HistoryArchiveObjectQueueSnapshot>;
	getRepairPlanSummary(
		archiveUrlIdentity: string
	): Promise<HistoryArchiveRepairPlanSummary>;
	getSummary(options?: {
		readonly archiveUrl?: string | null;
		readonly archiveUrlIdentity?: string | null;
	}): Promise<HistoryArchiveObjectSummaryV1>;
	getStatusSummary(): Promise<HistoryArchiveStatusSummaryV1>;
	getWorkerSnapshot(
		staleCutoff: Date
	): Promise<HistoryArchiveObjectWorkerSnapshot>;
	markObjectActive(
		remoteId: string,
		progress?: HistoryArchiveObjectProgressUpdate
	): Promise<boolean>;
	markObjectFailed(
		remoteId: string,
		failure: HistoryArchiveObjectFailure,
		hostFailure?: HistoryArchiveObjectHostFailure
	): Promise<boolean>;
	markObjectVerified(
		remoteId: string,
		progress?: HistoryArchiveObjectProgressUpdate
	): Promise<boolean>;
	markObjectsVerified(
		updates: readonly HistoryArchiveObjectVerificationUpdate[]
	): Promise<ReadonlySet<string>>;
	markTransitionEffectsCompleted(
		remoteId: string,
		claimAttempt: number,
		status: 'failed' | 'verified'
	): Promise<boolean>;
	withTransitionEffectsLock(
		remoteId: string,
		claimAttempt: number,
		work: () => Promise<void>
	): Promise<void>;
	materializeCheckpointDependencies(remoteId: string): Promise<number>;
	materializeCheckpointDependencyBatch(
		remoteIds: readonly string[]
	): Promise<number>;
	activateObjects(objects: readonly HistoryArchiveObject[]): Promise<number>;
	planObjects(objects: readonly HistoryArchiveObject[]): Promise<number>;
	promotePlannedObjects(): Promise<HistoryArchiveObjectPlanPromotionResult>;
	reconcileDependencyReadiness(limit: number): Promise<number>;
	reconcileExecutionDisposition(options?: {
		readonly admitGenericObjects?: boolean;
	}): Promise<HistoryArchiveObjectExecutionReconciliationResult>;
	tryWithTransitionReconciliationLock(
		work: () => Promise<void>
	): Promise<boolean>;
	releaseObject(remoteId: string, claimAttempt: number): Promise<boolean>;
	releaseStaleObjects(
		before: Date,
		limit?: number
	): Promise<readonly HistoryArchiveObject[]>;
	requestObjectRecheck(
		remoteId: string,
		minimumEvidenceUpdatedAt?: Date
	): Promise<HistoryArchiveObjectRecheckDecision | null>;
}
