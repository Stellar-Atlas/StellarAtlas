import type { HistoryArchiveObject } from './HistoryArchiveObject.js';
import type { HistoryArchiveObjectType } from './HistoryArchiveObject.js';
import type { HistoryArchiveObjectVerificationFacts } from './HistoryArchiveObject.js';
import type { HistoryArchiveObjectSummaryV1 } from 'shared';

export interface HistoryArchiveObjectQueueStats {
	readonly activeObjects: number;
	readonly failedObjects: number;
	readonly pendingObjects: number;
	readonly verifiedObjects: number;
}

export interface HistoryArchiveObjectQueueSnapshot
	extends HistoryArchiveObjectQueueStats {
	readonly objects: readonly HistoryArchiveObject[];
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

export interface HistoryArchiveObjectRepository {
	claimNextObject(
		supportedTypes: readonly HistoryArchiveObjectType[]
	): Promise<HistoryArchiveObject | null>;
	findByArchiveUrl(
		archiveUrl: string,
		limit: number
	): Promise<HistoryArchiveObjectQueueSnapshot>;
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
	releaseObject(remoteId: string, claimAttempt: number): Promise<boolean>;
	releaseStaleObjects(before: Date): Promise<number>;
	saveObjects(objects: readonly HistoryArchiveObject[]): Promise<number>;
}
