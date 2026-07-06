import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type {
	HistoryArchiveObjectQueueV1,
	HistoryArchiveObjectV1
} from 'shared';
import type { HistoryArchiveObjectQueueSnapshot } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { sanitizePublicInfrastructureText } from './PublicScanErrorMapper.js';

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

function mapHistoryArchiveObject(
	object: HistoryArchiveObject
): HistoryArchiveObjectV1 {
	return {
		archiveUrl: object.archiveUrl,
		archiveUrlIdentity: object.archiveUrlIdentity,
		attempts: object.attempts,
		bucketHash: object.bucketHash,
		bytesDownloaded: object.bytesDownloaded,
		checkpointLedger: object.checkpointLedger,
		claimedAt: object.claimedAt?.toISOString() ?? null,
		error:
			object.errorMessage === null
				? null
				: {
						httpStatus: object.httpStatus,
						message: sanitizePublicInfrastructureText(object.errorMessage),
						type: object.errorType ?? 'error'
					},
		objectKey: object.objectKey,
		objectType: object.objectType,
		objectUrl: object.objectUrl,
		remoteId: object.remoteId,
		nextAttemptAt: object.nextAttemptAt?.toISOString() ?? null,
		refreshAfter: object.refreshAfter?.toISOString() ?? null,
		status: object.status,
		updatedAt: requireDate(object.updatedAt).toISOString(),
		verificationFacts: toPublicVerificationFacts(object.verificationFacts),
		verifiedAt: object.verifiedAt?.toISOString() ?? null,
		workerStage: object.workerStage
	};
}

function requireDate(value: Date | undefined): Date {
	if (value instanceof Date) return value;
	return new Date(0);
}

function toPublicVerificationFacts(
	value: object | null
): Readonly<Record<string, unknown>> | null {
	if (value === null || Array.isArray(value)) return null;

	return value as Readonly<Record<string, unknown>>;
}
