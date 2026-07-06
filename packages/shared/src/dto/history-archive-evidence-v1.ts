import { JSONSchemaType } from 'ajv';
import {
	HistoryArchiveObjectEventsV1Schema,
	type HistoryArchiveObjectEventsV1
} from './history-archive-object-event-v1.js';
import {
	HistoryArchiveObjectQueueV1Schema,
	type HistoryArchiveObjectQueueV1
} from './history-archive-object-v1.js';
import {
	HistoryArchiveObjectSummaryV1Schema,
	type HistoryArchiveObjectSummaryV1
} from './history-archive-object-summary-v1.js';
import {
	HistoryArchiveStateSnapshotV1Schema,
	type HistoryArchiveStateSnapshotV1
} from './history-archive-state-v1.js';
import { nullable } from './helper/nullable.js';

export interface HistoryArchiveEvidenceV1 {
	readonly archiveUrl: string;
	readonly generatedAt: string;
	readonly objectEvents: HistoryArchiveObjectEventsV1;
	readonly objects: HistoryArchiveObjectQueueV1;
	readonly scannerOwnedState: HistoryArchiveStateSnapshotV1 | null;
	readonly summary: HistoryArchiveObjectSummaryV1;
}

export const HistoryArchiveEvidenceV1Schema: JSONSchemaType<HistoryArchiveEvidenceV1> =
	{
		$id: 'history-archive-evidence-v1.json',
		$schema: 'http://json-schema.org/draft-07/schema#',
		type: 'object',
		properties: {
			archiveUrl: { type: 'string' },
			generatedAt: { type: 'string', format: 'date-time' },
			objectEvents: HistoryArchiveObjectEventsV1Schema,
			objects: HistoryArchiveObjectQueueV1Schema,
			scannerOwnedState: nullable(HistoryArchiveStateSnapshotV1Schema),
			summary: HistoryArchiveObjectSummaryV1Schema
		},
		required: [
			'archiveUrl',
			'generatedAt',
			'objectEvents',
			'objects',
			'scannerOwnedState',
			'summary'
		],
		additionalProperties: false
	};
