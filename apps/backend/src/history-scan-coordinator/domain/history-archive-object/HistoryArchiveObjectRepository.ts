import type { HistoryArchiveObject } from './HistoryArchiveObject.js';
import type { HistoryArchiveObjectType } from './HistoryArchiveObject.js';
import type { HistoryArchiveObjectVerificationFacts } from './HistoryArchiveObject.js';
import type {
	HistoryArchiveObjectEvidenceClass,
	HistoryArchiveObjectFailureClass
} from './HistoryArchiveObjectRetryPolicy.js';
import type {
	HistoryArchiveObjectSummaryV1,
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
	readonly verificationFacts?: HistoryArchiveObjectVerificationFacts | null;
	readonly workerStage?: string | null;
}

export interface HistoryArchiveObjectFailure {
	readonly claimAttempt: number;
	readonly errorMessage: string;
	readonly errorType: string;
	readonly failureChannel: HistoryArchiveObjectFailureChannelDTO;
	readonly httpStatus?: number | null;
	readonly nextAttemptAt?: Date | null;
	readonly retryAfterSeconds?: number | null;
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

export interface HistoryArchiveObjectRepository {
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
	findByRemoteId(remoteId: string): Promise<HistoryArchiveObject | null>;
	findLatestActivityAt(): Promise<Date | null>;
	findUnreconciledTransitions(
		limit: number
	): Promise<readonly HistoryArchiveObject[]>;
	findVerifiedCheckpointsNeedingReconciliation(
		limit: number
	): Promise<readonly HistoryArchiveObject[]>;
	findOldestCheckpointLedgerByArchiveUrlIdentities(
		archiveUrlIdentities: readonly string[]
	): Promise<ReadonlyMap<string, number>>;
	findVerifiedBucketObjectsByArchiveUrl(
		archiveUrl: string,
		limit: number
	): Promise<readonly HistoryArchiveObject[]>;
	getQueueSnapshot(limit: number): Promise<HistoryArchiveObjectQueueSnapshot>;
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
	markTransitionEffectsCompleted(
		remoteId: string,
		claimAttempt: number,
		status: 'failed' | 'verified'
	): Promise<boolean>;
	materializeCheckpointDependencies(remoteId: string): Promise<number>;
	planObjects(objects: readonly HistoryArchiveObject[]): Promise<number>;
	promotePlannedObjects(): Promise<HistoryArchiveObjectPlanPromotionResult>;
	reconcileDependencyReadiness(limit: number): Promise<number>;
	reconcileExecutionDisposition(): Promise<HistoryArchiveObjectExecutionReconciliationResult>;
	tryWithTransitionReconciliationLock(
		work: () => Promise<void>
	): Promise<boolean>;
	releaseObject(remoteId: string, claimAttempt: number): Promise<boolean>;
	releaseStaleObjects(
		before: Date,
		limit?: number
	): Promise<readonly HistoryArchiveObject[]>;
}
