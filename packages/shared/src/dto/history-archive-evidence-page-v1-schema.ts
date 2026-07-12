import { JSONSchemaType } from 'ajv';
import { HistoryArchiveObjectV1Schema } from './history-archive-object-v1.js';
import { HistoryArchiveObjectEventV1Schema } from './history-archive-object-event-v1.js';
import { nullable } from './helper/nullable.js';
import type {
	HistoryArchiveObjectEventTypeV1,
	HistoryArchiveObjectEvidenceClassV1
} from './history-archive-object-event-v1.js';
import type {
	HistoryArchiveObjectStatusV1,
	HistoryArchiveObjectTypeV1
} from './history-archive-object-v1.js';
import type {
	HistoryArchiveObjectEventPageFiltersV1,
	HistoryArchiveObjectEventPageV1,
	HistoryArchiveObjectPageFiltersV1,
	HistoryArchiveObjectPageV1,
	HistoryArchivePageMetadataV1
} from './history-archive-evidence-page-v1.js';

const objectTypes = [
	'history-archive-state',
	'checkpoint-state',
	'ledger',
	'transactions',
	'results',
	'scp',
	'bucket'
] as const;

const HistoryArchivePageMetadataV1Schema: JSONSchemaType<HistoryArchivePageMetadataV1> =
	{
		type: 'object',
		properties: {
			hasMore: { type: 'boolean' },
			limit: { type: 'number' },
			nextCursor: nullable({ type: 'string' }),
			snapshotAt: { type: 'string', format: 'date-time' },
			total: { type: 'number' }
		},
		required: ['hasMore', 'limit', 'nextCursor', 'snapshotAt', 'total'],
		additionalProperties: false
	};

const HistoryArchiveObjectPageFiltersV1Schema: JSONSchemaType<HistoryArchiveObjectPageFiltersV1> =
	{
		type: 'object',
		properties: {
			archiveUrlIdentity: nullable({ type: 'string' }),
			objectType: nullable({
				type: 'string',
				enum: [...objectTypes, null] as unknown as HistoryArchiveObjectTypeV1[]
			}),
			status: nullable({
				type: 'string',
				enum: [
					'pending',
					'scanning',
					'verified',
					'failed',
					null
				] as unknown as HistoryArchiveObjectStatusV1[]
			})
		},
		required: ['archiveUrlIdentity', 'objectType', 'status'],
		additionalProperties: false
	};

export const HistoryArchiveObjectPageV1Schema: JSONSchemaType<HistoryArchiveObjectPageV1> =
	{
		$id: 'history-archive-object-page-v1.json',
		$schema: 'http://json-schema.org/draft-07/schema#',
		type: 'object',
		properties: {
			filters: HistoryArchiveObjectPageFiltersV1Schema,
			objects: { type: 'array', items: HistoryArchiveObjectV1Schema },
			page: HistoryArchivePageMetadataV1Schema
		},
		required: ['filters', 'objects', 'page'],
		additionalProperties: false
	};

const HistoryArchiveObjectEventPageFiltersV1Schema: JSONSchemaType<HistoryArchiveObjectEventPageFiltersV1> =
	{
		type: 'object',
		properties: {
			archiveUrlIdentity: nullable({ type: 'string' }),
			evidenceClass: nullable({
				type: 'string',
				enum: [
					'archive-object',
					'worker-infrastructure',
					'coordinator-infrastructure',
					null
				] as unknown as HistoryArchiveObjectEvidenceClassV1[]
			}),
			eventType: nullable({
				type: 'string',
				enum: [
					'claimed',
					'heartbeat',
					'verified',
					'failed',
					'released',
					null
				] as unknown as HistoryArchiveObjectEventTypeV1[]
			}),
			objectType: nullable({
				type: 'string',
				enum: [...objectTypes, null] as unknown as HistoryArchiveObjectTypeV1[]
			})
		},
		required: [
			'archiveUrlIdentity',
			'evidenceClass',
			'eventType',
			'objectType'
		],
		additionalProperties: false
	};

export const HistoryArchiveObjectEventPageV1Schema: JSONSchemaType<HistoryArchiveObjectEventPageV1> =
	{
		$id: 'history-archive-object-event-page-v1.json',
		$schema: 'http://json-schema.org/draft-07/schema#',
		type: 'object',
		properties: {
			events: { type: 'array', items: HistoryArchiveObjectEventV1Schema },
			filters: HistoryArchiveObjectEventPageFiltersV1Schema,
			page: HistoryArchivePageMetadataV1Schema
		},
		required: ['events', 'filters', 'page'],
		additionalProperties: false
	};
