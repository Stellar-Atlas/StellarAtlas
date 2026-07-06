import type { HistoryArchiveObjectEvent } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectEvent.js';
import type {
	HistoryArchiveObjectEventsV1,
	HistoryArchiveObjectEventV1
} from 'shared';
import type { HistoryArchiveObjectEventPage } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectEventRepository.js';
import { sanitizePublicInfrastructureText } from './PublicScanErrorMapper.js';

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

function mapHistoryArchiveObjectEvent(
	event: HistoryArchiveObjectEvent
): HistoryArchiveObjectEventV1 {
	return {
		archiveUrl: event.archiveUrl,
		archiveUrlIdentity: event.archiveUrlIdentity,
		bucketHash: event.bucketHash,
		bytesDownloaded: toPublicNumber(event.bytesDownloaded),
		checkpointLedger: event.checkpointLedger,
		claimAttempt: event.claimAttempt,
		createdAt: requireDate(event.createdAt).toISOString(),
		error:
			event.errorMessage === null
				? null
				: {
						httpStatus: event.httpStatus,
						message: sanitizePublicInfrastructureText(event.errorMessage),
						type: event.errorType ?? 'error'
					},
		eventType: event.eventType,
		evidenceClass: event.evidenceClass,
		nextAttemptAt: event.nextAttemptAt?.toISOString() ?? null,
		objectKey: event.objectKey,
		objectRemoteId: event.objectRemoteId,
		objectType: event.objectType,
		objectUrl: event.objectUrl,
		remoteId: event.remoteId,
		verificationFacts: toPublicVerificationFacts(event.verificationFacts),
		workerStage: event.workerStage
	};
}

function requireDate(value: Date | undefined): Date {
	if (value instanceof Date) return value;
	return new Date(0);
}

function toPublicNumber(value: number | string | null): number | null {
	if (value === null) return null;
	if (typeof value === 'number') return value;

	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function toPublicVerificationFacts(
	value: object | null
): Readonly<Record<string, unknown>> | null {
	if (value === null || Array.isArray(value)) return null;

	return value as Readonly<Record<string, unknown>>;
}
