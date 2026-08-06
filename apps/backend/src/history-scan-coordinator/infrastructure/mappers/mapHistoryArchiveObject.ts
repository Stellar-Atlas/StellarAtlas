import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type {
	HistoryArchiveObjectQueueV1,
	HistoryArchiveObjectV1
} from 'shared';
import type { HistoryArchiveObjectQueueSnapshot } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import {
	mapPublicArchiveError,
	mapPublicArchiveUrl,
	mapPublicVerificationFacts,
	mapPublicWorkerStage
} from './PublicArchiveObjectFactsMapper.js';
import { requireDate, toPublicNumber } from './mapHistoryArchiveBucketCoverage.js';

export function mapHistoryArchiveObjectQueue(
	snapshot: HistoryArchiveObjectQueueSnapshot,
	generatedAt: Date
): HistoryArchiveObjectQueueV1 {
	return {
		activeObjects: snapshot.activeObjects,
		failedObjects: snapshot.failedObjects,
		generatedAt: generatedAt.toISOString(),
		objects: snapshot.objects.map(mapHistoryArchiveObject),
		pendingObjects: snapshot.pendingObjects,
		verifiedObjects: snapshot.verifiedObjects
	};
}

export function mapHistoryArchiveObject(
	object: HistoryArchiveObject
): HistoryArchiveObjectV1 {
	return {
		archiveUrl: mapPublicArchiveUrl(object.archiveUrl),
		archiveUrlIdentity: mapPublicArchiveUrl(object.archiveUrlIdentity),
		attempts: object.attempts,
		bucketHash: object.bucketHash,
		bytesDownloaded: toPublicNumber(object.bytesDownloaded),
		checkpointLedger: object.checkpointLedger,
		claimedAt: object.claimedAt?.toISOString() ?? null,
		delayReason: object.delayReason,
		error: mapPublicArchiveError(object),
		objectKey: object.objectKey,
		objectType: object.objectType,
		objectUrl: mapPublicArchiveUrl(object.objectUrl),
		remoteId: object.remoteId,
		nextAttemptAt: object.nextAttemptAt?.toISOString() ?? null,
		refreshAfter: object.refreshAfter?.toISOString() ?? null,
		status: object.status,
		updatedAt: requireDate(object.updatedAt).toISOString(),
		verificationFacts: mapPublicVerificationFacts(object.verificationFacts),
		verifiedAt: object.verifiedAt?.toISOString() ?? null,
		workerStage: mapPublicWorkerStage(object.workerStage)
	};
}
