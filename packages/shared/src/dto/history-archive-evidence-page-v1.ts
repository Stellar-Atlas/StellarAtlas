import type {
	HistoryArchiveObjectStatusV1,
	HistoryArchiveObjectTypeV1,
	HistoryArchiveObjectV1
} from './history-archive-object-v1.js';
import type {
	HistoryArchiveObjectEventTypeV1,
	HistoryArchiveObjectEventV1,
	HistoryArchiveObjectEvidenceClassV1
} from './history-archive-object-event-v1.js';

export interface HistoryArchivePageMetadataV1 {
	readonly hasMore: boolean;
	readonly limit: number;
	readonly nextCursor: string | null;
	readonly snapshotAt: string;
	readonly total: number;
}

export interface HistoryArchiveObjectPageFiltersV1 {
	readonly archiveUrlIdentity: string | null;
	readonly objectType: HistoryArchiveObjectTypeV1 | null;
	readonly status: HistoryArchiveObjectStatusV1 | null;
}

export interface HistoryArchiveObjectPageV1 {
	readonly filters: HistoryArchiveObjectPageFiltersV1;
	readonly objects: readonly HistoryArchiveObjectV1[];
	readonly page: HistoryArchivePageMetadataV1;
}

export interface HistoryArchiveObjectEventPageFiltersV1 {
	readonly archiveUrlIdentity: string | null;
	readonly evidenceClass: HistoryArchiveObjectEvidenceClassV1 | null;
	readonly eventType: HistoryArchiveObjectEventTypeV1 | null;
	readonly objectType: HistoryArchiveObjectTypeV1 | null;
}

export interface HistoryArchiveObjectEventPageV1 {
	readonly events: readonly HistoryArchiveObjectEventV1[];
	readonly filters: HistoryArchiveObjectEventPageFiltersV1;
	readonly page: HistoryArchivePageMetadataV1;
}

export {
	HistoryArchiveObjectEventPageV1Schema,
	HistoryArchiveObjectPageV1Schema
} from './history-archive-evidence-page-v1-schema.js';
