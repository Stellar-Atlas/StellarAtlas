import { JSONSchemaType } from 'ajv';
import { nullable } from './helper/nullable.js';

export type HistoryArchiveObjectTypeV1 =
	| 'history-archive-state'
	| 'checkpoint-state'
	| 'ledger'
	| 'transactions'
	| 'results'
	| 'scp'
	| 'bucket';

export type HistoryArchiveObjectStatusV1 =
	'pending' | 'scanning' | 'verified' | 'failed';

export interface HistoryArchiveObjectErrorV1 {
	readonly message: string;
	readonly type: string;
	readonly httpStatus: number | null;
}

export interface HistoryArchiveObjectV1 {
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
	readonly objectKey: string;
	readonly objectType: HistoryArchiveObjectTypeV1;
	readonly objectUrl: string;
	readonly remoteId: string;
	readonly status: HistoryArchiveObjectStatusV1;
	readonly workerStage: string | null;
	readonly checkpointLedger: number | null;
	readonly bucketHash: string | null;
	readonly bytesDownloaded: number | null;
	readonly attempts: number;
	readonly nextAttemptAt: string | null;
	readonly refreshAfter: string | null;
	readonly claimedAt: string | null;
	readonly updatedAt: string;
	readonly verificationFacts: Readonly<Record<string, unknown>> | null;
	readonly verifiedAt: string | null;
	readonly error: HistoryArchiveObjectErrorV1 | null;
}

export interface HistoryArchiveObjectQueueV1 {
	readonly generatedAt: string;
	readonly pendingObjects: number;
	readonly activeObjects: number;
	readonly verifiedObjects: number;
	readonly failedObjects: number;
	readonly objects: readonly HistoryArchiveObjectV1[];
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

const HistoryArchiveObjectV1Schema: JSONSchemaType<HistoryArchiveObjectV1> = {
	type: 'object',
	properties: {
		archiveUrl: { type: 'string' },
		archiveUrlIdentity: { type: 'string' },
		objectKey: { type: 'string' },
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
		},
		objectUrl: { type: 'string' },
		remoteId: { type: 'string' },
		status: {
			type: 'string',
			enum: ['pending', 'scanning', 'verified', 'failed']
		},
		workerStage: nullable({ type: 'string' }),
		checkpointLedger: nullable({ type: 'number' }),
		bucketHash: nullable({ type: 'string' }),
		bytesDownloaded: nullable({ type: 'number' }),
		attempts: { type: 'number' },
		nextAttemptAt: nullable({ type: 'string' }),
		refreshAfter: nullable({ type: 'string' }),
		claimedAt: nullable({ type: 'string' }),
		updatedAt: { type: 'string' },
		verificationFacts: nullable({
			type: 'object',
			additionalProperties: true,
			required: []
		}),
		verifiedAt: nullable({ type: 'string' }),
		error: nullable(HistoryArchiveObjectErrorV1Schema)
	},
	required: [
		'archiveUrl',
		'archiveUrlIdentity',
		'objectKey',
		'objectType',
		'objectUrl',
		'remoteId',
		'status',
		'workerStage',
		'checkpointLedger',
		'bucketHash',
		'bytesDownloaded',
		'attempts',
		'nextAttemptAt',
		'refreshAfter',
		'claimedAt',
		'updatedAt',
		'verificationFacts',
		'verifiedAt',
		'error'
	],
	additionalProperties: false
};

export const HistoryArchiveObjectQueueV1Schema: JSONSchemaType<HistoryArchiveObjectQueueV1> =
	{
		$id: 'history-archive-object-queue-v1.json',
		$schema: 'http://json-schema.org/draft-07/schema#',
		type: 'object',
		properties: {
			generatedAt: { type: 'string', format: 'date-time' },
			pendingObjects: { type: 'number' },
			activeObjects: { type: 'number' },
			verifiedObjects: { type: 'number' },
			failedObjects: { type: 'number' },
			objects: {
				type: 'array',
				items: HistoryArchiveObjectV1Schema
			}
		},
		required: [
			'generatedAt',
			'pendingObjects',
			'activeObjects',
			'verifiedObjects',
			'failedObjects',
			'objects'
		],
		additionalProperties: false
	};
