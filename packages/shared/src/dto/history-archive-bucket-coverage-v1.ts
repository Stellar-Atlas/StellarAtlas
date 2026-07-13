import type { JSONSchemaType } from 'ajv';
import { nullable } from './helper/nullable.js';
import type {
	HistoryArchiveObjectErrorV1,
	HistoryArchiveObjectStatusV1
} from './history-archive-object-v1.js';

export interface HistoryArchiveBucketCopyV1 {
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
	readonly attempts: number;
	readonly bytesDownloaded: number | null;
	readonly claimedAt: string | null;
	readonly error: HistoryArchiveObjectErrorV1 | null;
	readonly nextAttemptAt: string | null;
	readonly objectKey: string;
	readonly objectUrl: string;
	readonly remoteId: string;
	readonly status: HistoryArchiveObjectStatusV1;
	readonly updatedAt: string;
	readonly verifiedAt: string | null;
	readonly workerStage: string | null;
}

export interface HistoryArchiveBucketArchiveRootV1 {
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
	readonly status: HistoryArchiveObjectStatusV1;
	readonly updatedAt: string;
	readonly verifiedAt: string | null;
}

export interface HistoryArchiveBucketCoverageCountsV1 {
	readonly archiveRoots: number;
	readonly failedCopies: number;
	readonly pendingCopies: number;
	readonly scanningCopies: number;
	readonly totalCopies: number;
	readonly verifiedCopies: number;
}

export interface HistoryArchiveBucketCrossCoverageV1 {
	readonly archiveRoots: readonly HistoryArchiveBucketArchiveRootV1[];
	readonly bucketHash: string;
	readonly counts: HistoryArchiveBucketCoverageCountsV1;
	readonly failedCopies: readonly HistoryArchiveBucketCopyV1[];
	readonly generatedAt: string;
	readonly pendingCopies: readonly HistoryArchiveBucketCopyV1[];
	readonly scanningCopies: readonly HistoryArchiveBucketCopyV1[];
	readonly verifiedCopies: readonly HistoryArchiveBucketCopyV1[];
}

const HistoryArchiveObjectErrorV1Schema: JSONSchemaType<HistoryArchiveObjectErrorV1> =
	{
		type: 'object',
		properties: {
			message: { type: 'string' },
			type: { type: 'string' },
			httpStatus: nullable({ type: 'number' })
		},
		required: ['message', 'type', 'httpStatus'],
		additionalProperties: false
	};

const HistoryArchiveObjectStatusV1Schema = {
	type: 'string',
	enum: ['pending', 'scanning', 'verified', 'failed']
} as const;

const HistoryArchiveBucketCopyV1Schema: JSONSchemaType<HistoryArchiveBucketCopyV1> =
	{
		type: 'object',
		properties: {
			archiveUrl: { type: 'string' },
			archiveUrlIdentity: { type: 'string' },
			attempts: { type: 'number' },
			bytesDownloaded: nullable({ type: 'number' }),
			claimedAt: nullable({ type: 'string' }),
			error: nullable(HistoryArchiveObjectErrorV1Schema),
			nextAttemptAt: nullable({ type: 'string' }),
			objectKey: { type: 'string' },
			objectUrl: { type: 'string' },
			remoteId: { type: 'string' },
			status: HistoryArchiveObjectStatusV1Schema,
			updatedAt: { type: 'string' },
			verifiedAt: nullable({ type: 'string' }),
			workerStage: nullable({ type: 'string' })
		},
		required: [
			'archiveUrl',
			'archiveUrlIdentity',
			'attempts',
			'bytesDownloaded',
			'claimedAt',
			'error',
			'nextAttemptAt',
			'objectKey',
			'objectUrl',
			'remoteId',
			'status',
			'updatedAt',
			'verifiedAt',
			'workerStage'
		],
		additionalProperties: false
	};

const HistoryArchiveBucketArchiveRootV1Schema: JSONSchemaType<HistoryArchiveBucketArchiveRootV1> =
	{
		type: 'object',
		properties: {
			archiveUrl: { type: 'string' },
			archiveUrlIdentity: { type: 'string' },
			status: HistoryArchiveObjectStatusV1Schema,
			updatedAt: { type: 'string' },
			verifiedAt: nullable({ type: 'string' })
		},
		required: [
			'archiveUrl',
			'archiveUrlIdentity',
			'status',
			'updatedAt',
			'verifiedAt'
		],
		additionalProperties: false
	};

const HistoryArchiveBucketCoverageCountsV1Schema: JSONSchemaType<HistoryArchiveBucketCoverageCountsV1> =
	{
		type: 'object',
		properties: {
			archiveRoots: { type: 'number' },
			failedCopies: { type: 'number' },
			pendingCopies: { type: 'number' },
			scanningCopies: { type: 'number' },
			totalCopies: { type: 'number' },
			verifiedCopies: { type: 'number' }
		},
		required: [
			'archiveRoots',
			'failedCopies',
			'pendingCopies',
			'scanningCopies',
			'totalCopies',
			'verifiedCopies'
		],
		additionalProperties: false
	};

export const HistoryArchiveBucketCrossCoverageV1Schema: JSONSchemaType<HistoryArchiveBucketCrossCoverageV1> =
	{
		$id: 'history-archive-bucket-coverage-v1.json',
		$schema: 'http://json-schema.org/draft-07/schema#',
		type: 'object',
		properties: {
			archiveRoots: {
				type: 'array',
				items: HistoryArchiveBucketArchiveRootV1Schema
			},
			bucketHash: { type: 'string' },
			counts: HistoryArchiveBucketCoverageCountsV1Schema,
			failedCopies: {
				type: 'array',
				items: HistoryArchiveBucketCopyV1Schema
			},
			generatedAt: { type: 'string', format: 'date-time' },
			pendingCopies: {
				type: 'array',
				items: HistoryArchiveBucketCopyV1Schema
			},
			scanningCopies: {
				type: 'array',
				items: HistoryArchiveBucketCopyV1Schema
			},
			verifiedCopies: {
				type: 'array',
				items: HistoryArchiveBucketCopyV1Schema
			}
		},
		required: [
			'archiveRoots',
			'bucketHash',
			'counts',
			'failedCopies',
			'generatedAt',
			'pendingCopies',
			'scanningCopies',
			'verifiedCopies'
		],
		additionalProperties: false
	};
