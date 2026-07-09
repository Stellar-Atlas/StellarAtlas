import type { HistoryArchiveObject } from './HistoryArchiveObject.js';
import type { HistoryArchiveObjectType } from './HistoryArchiveObject.js';
import type { HistoryArchiveObjectVerificationFacts } from './HistoryArchiveObject.js';
import type {
	HistoryArchiveObjectEvidenceClass,
	HistoryArchiveObjectFailureClass
} from './HistoryArchiveObjectRetryPolicy.js';
import type { HistoryArchiveObjectSummaryV1 } from 'shared';

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
	readonly bytesDownloaded?: number | null;
	readonly claimAttempt: number;
	readonly verificationFacts?: HistoryArchiveObjectVerificationFacts | null;
	readonly workerStage?: string | null;
}

export interface HistoryArchiveObjectFailure {
	readonly claimAttempt: number;
	readonly errorMessage: string;
	readonly errorType: string;
	readonly httpStatus?: number | null;
	readonly nextAttemptAt?: Date | null;
}

export interface HistoryArchiveObjectHostFailure {
	readonly archiveUrlIdentity: string;
	readonly blockedUntil: Date;
	readonly errorType: string;
	readonly evidenceClass: HistoryArchiveObjectEvidenceClass;
	readonly failureClass: HistoryArchiveObjectFailureClass;
	readonly hostIdentity: string;
	readonly httpStatus?: number | null;
}

export interface HistoryArchiveObjectRepository {
	clearHostThrottle(hostIdentity: string): Promise<void>;
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
	getStatusSummary(): Promise<HistoryArchiveObjectSummaryV1>;
	getWorkerSnapshot(
		staleCutoff: Date
	): Promise<HistoryArchiveObjectWorkerSnapshot>;
	markObjectActive(
		remoteId: string,
		progress?: HistoryArchiveObjectProgressUpdate
	): Promise<boolean>;
	markObjectFailed(
		remoteId: string,
		failure: HistoryArchiveObjectFailure
	): Promise<boolean>;
	markObjectVerified(
		remoteId: string,
		progress?: HistoryArchiveObjectProgressUpdate
	): Promise<boolean>;
	recordHostFailure(failure: HistoryArchiveObjectHostFailure): Promise<void>;
	releaseObject(remoteId: string, claimAttempt: number): Promise<boolean>;
	releaseStaleObjects(before: Date): Promise<number>;
	saveObjects(objects: readonly HistoryArchiveObject[]): Promise<number>;
}
