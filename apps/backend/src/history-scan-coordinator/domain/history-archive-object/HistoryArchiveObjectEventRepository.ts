import type { HistoryArchiveObject } from './HistoryArchiveObject.js';
import type {
	HistoryArchiveObjectEvent,
	HistoryArchiveObjectEventType
} from './HistoryArchiveObjectEvent.js';
import type { HistoryArchiveObjectEvidenceClass } from './HistoryArchiveObjectRetryPolicy.js';

export interface HistoryArchiveObjectEventOptions {
	readonly claimAttempt?: number | null;
	readonly eventType: HistoryArchiveObjectEventType;
	readonly evidenceClass?: HistoryArchiveObjectEvidenceClass | null;
}

export interface HistoryArchiveObjectEventPage {
	readonly count: number;
	readonly events: readonly HistoryArchiveObjectEvent[];
	readonly limit: number;
}

export interface HistoryArchiveObjectEventRepository {
	appendFromObject(
		object: HistoryArchiveObject,
		options: HistoryArchiveObjectEventOptions
	): Promise<void>;
	appendFromObjectIdempotently(
		object: HistoryArchiveObject,
		options: HistoryArchiveObjectEventOptions
	): Promise<void>;
	findRecent(options: {
		readonly archiveUrlIdentity?: string;
		readonly limit: number;
	}): Promise<HistoryArchiveObjectEventPage>;
}
