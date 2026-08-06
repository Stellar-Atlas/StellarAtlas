import type { HistoryArchiveObjectEvent } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectEvent.js';
import type {
	HistoryArchiveObjectEventsV1,
	HistoryArchiveObjectEventV1
} from 'shared';
import type { HistoryArchiveObjectEventPage } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectEventRepository.js';
import {
	mapPublicArchiveError,
	mapPublicArchiveUrl,
	mapPublicVerificationFacts,
	mapPublicWorkerStage
} from './PublicArchiveObjectFactsMapper.js';
import { requireDate, toPublicNumber } from './mapHistoryArchiveBucketCoverage.js';
export function mapHistoryArchiveObjectEvents(
	page: HistoryArchiveObjectEventPage,
	generatedAt: Date
): HistoryArchiveObjectEventsV1 {
	return {
		count: page.count,
		events: page.events.map(mapHistoryArchiveObjectEvent),
		generatedAt: generatedAt.toISOString(),
		limit: page.limit
	};
}

export function mapHistoryArchiveObjectEvent(
	event: HistoryArchiveObjectEvent
): HistoryArchiveObjectEventV1 {
	return {
		archiveUrl: mapPublicArchiveUrl(event.archiveUrl),
		archiveUrlIdentity: mapPublicArchiveUrl(event.archiveUrlIdentity),
		bucketHash: event.bucketHash,
		bytesDownloaded: toPublicNumber(event.bytesDownloaded),
		checkpointLedger: event.checkpointLedger,
		claimAttempt: event.claimAttempt,
		createdAt: requireDate(event.createdAt).toISOString(),
		error: mapPublicArchiveError({
			errorMessage: event.errorMessage,
			errorType: event.errorType,
			failureChannel:
				event.failureChannel ??
				(event.evidenceClass === 'archive-object'
					? 'archive_evidence'
					: event.evidenceClass === null
						? null
						: 'scanner_issue'),
			httpStatus: event.httpStatus
		}),
		eventType: event.eventType,
		evidenceClass: event.evidenceClass,
		nextAttemptAt: event.nextAttemptAt?.toISOString() ?? null,
		objectKey: event.objectKey,
		objectRemoteId: event.objectRemoteId,
		objectType: event.objectType,
		objectUrl: mapPublicArchiveUrl(event.objectUrl),
		remoteId: event.remoteId,
		verificationFacts: mapPublicVerificationFacts(event.verificationFacts),
		workerStage: mapPublicWorkerStage(event.workerStage)
	};
}
