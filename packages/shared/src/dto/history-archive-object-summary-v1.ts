import { JSONSchemaType } from 'ajv';
import { nullable } from './helper/nullable.js';
import type { HistoryArchiveObjectTypeV1 } from './history-archive-object-v1.js';

export interface HistoryArchiveObjectStatusCountsV1 {
	readonly activeObjects: number;
	readonly failedObjects: number;
	readonly pendingObjects: number;
	readonly totalObjects: number;
	readonly verifiedObjects: number;
}

export interface HistoryArchiveObjectTypeSummaryV1 extends HistoryArchiveObjectStatusCountsV1 {
	readonly objectType: HistoryArchiveObjectTypeV1;
}

export interface HistoryArchiveCheckpointCoverageV1 {
	readonly activeArchiveCheckpoints: number;
	readonly completeArchiveCheckpoints: number;
	readonly failedArchiveCheckpoints: number;
	readonly latestCheckpointLedger: number | null;
	readonly oldestCheckpointLedger: number | null;
	readonly partialArchiveCheckpoints: number;
	readonly totalArchiveCheckpoints: number;
}

export interface HistoryArchiveBucketCoverageV1 {
	readonly activeBucketObjects: number;
	readonly failedBucketObjects: number;
	readonly pendingBucketObjects: number;
	readonly totalBucketObjects: number;
	readonly uniqueBucketHashes: number;
	readonly verifiedBucketObjects: number;
}

export interface HistoryArchiveObjectSummaryV1 extends HistoryArchiveObjectStatusCountsV1 {
	readonly archiveUrl: string | null;
	readonly archiveUrlIdentity: string | null;
	readonly buckets: HistoryArchiveBucketCoverageV1;
	readonly checkpoints: HistoryArchiveCheckpointCoverageV1;
	readonly generatedAt: string;
	readonly objectTypes: readonly HistoryArchiveObjectTypeSummaryV1[];
	readonly scope: 'archive' | 'global';
}

const HistoryArchiveObjectStatusCountsV1Schema: JSONSchemaType<HistoryArchiveObjectStatusCountsV1> =
	{
		type: 'object',
		properties: {
			activeObjects: { type: 'number' },
			failedObjects: { type: 'number' },
			pendingObjects: { type: 'number' },
			totalObjects: { type: 'number' },
			verifiedObjects: { type: 'number' }
		},
		required: [
			'activeObjects',
			'failedObjects',
			'pendingObjects',
			'totalObjects',
			'verifiedObjects'
		],
		additionalProperties: false
	};

const HistoryArchiveObjectTypeSummaryV1Schema: JSONSchemaType<HistoryArchiveObjectTypeSummaryV1> =
	{
		type: 'object',
		properties: {
			activeObjects: { type: 'number' },
			failedObjects: { type: 'number' },
			pendingObjects: { type: 'number' },
			totalObjects: { type: 'number' },
			verifiedObjects: { type: 'number' },
			objectType: {
				type: 'string',
				enum: [
					'history-archive-state',
					'checkpoint-state',
					'ledger',
					'transactions',
					'results',
					'scp',
					'bucket'
				]
			}
		},
		required: [
			'activeObjects',
			'failedObjects',
			'pendingObjects',
			'totalObjects',
			'verifiedObjects',
			'objectType'
		],
		additionalProperties: false
	};

const HistoryArchiveCheckpointCoverageV1Schema: JSONSchemaType<HistoryArchiveCheckpointCoverageV1> =
	{
		type: 'object',
		properties: {
			activeArchiveCheckpoints: { type: 'number' },
			completeArchiveCheckpoints: { type: 'number' },
			failedArchiveCheckpoints: { type: 'number' },
			latestCheckpointLedger: nullable({ type: 'number' }),
			oldestCheckpointLedger: nullable({ type: 'number' }),
			partialArchiveCheckpoints: { type: 'number' },
			totalArchiveCheckpoints: { type: 'number' }
		},
		required: [
			'activeArchiveCheckpoints',
			'completeArchiveCheckpoints',
			'failedArchiveCheckpoints',
			'latestCheckpointLedger',
			'oldestCheckpointLedger',
			'partialArchiveCheckpoints',
			'totalArchiveCheckpoints'
		],
		additionalProperties: false
	};

const HistoryArchiveBucketCoverageV1Schema: JSONSchemaType<HistoryArchiveBucketCoverageV1> =
	{
		type: 'object',
		properties: {
			activeBucketObjects: { type: 'number' },
			failedBucketObjects: { type: 'number' },
			pendingBucketObjects: { type: 'number' },
			totalBucketObjects: { type: 'number' },
			uniqueBucketHashes: { type: 'number' },
			verifiedBucketObjects: { type: 'number' }
		},
		required: [
			'activeBucketObjects',
			'failedBucketObjects',
			'pendingBucketObjects',
			'totalBucketObjects',
			'uniqueBucketHashes',
			'verifiedBucketObjects'
		],
		additionalProperties: false
	};

export const HistoryArchiveObjectSummaryV1Schema: JSONSchemaType<HistoryArchiveObjectSummaryV1> =
	{
		$id: 'history-archive-object-summary-v1.json',
		$schema: 'http://json-schema.org/draft-07/schema#',
		type: 'object',
		properties: {
			activeObjects: { type: 'number' },
			archiveUrl: nullable({ type: 'string' }),
			archiveUrlIdentity: nullable({ type: 'string' }),
			buckets: HistoryArchiveBucketCoverageV1Schema,
			checkpoints: HistoryArchiveCheckpointCoverageV1Schema,
			failedObjects: { type: 'number' },
			generatedAt: { type: 'string', format: 'date-time' },
			objectTypes: {
				type: 'array',
				items: HistoryArchiveObjectTypeSummaryV1Schema
			},
			pendingObjects: { type: 'number' },
			scope: { type: 'string', enum: ['archive', 'global'] },
			totalObjects: { type: 'number' },
			verifiedObjects: { type: 'number' }
		},
		required: [
			'activeObjects',
			'archiveUrl',
			'archiveUrlIdentity',
			'buckets',
			'checkpoints',
			'failedObjects',
			'generatedAt',
			'objectTypes',
			'pendingObjects',
			'scope',
			'totalObjects',
			'verifiedObjects'
		],
		additionalProperties: false
	};
