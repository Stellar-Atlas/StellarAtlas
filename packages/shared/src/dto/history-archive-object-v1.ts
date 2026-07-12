import { JSONSchemaType } from 'ajv';
import { nullable } from './helper/nullable.js';
import type {
	HistoryArchivePublicCategorySummaryV1,
	HistoryArchivePublicVerificationFactsV1
} from './history-archive-object-verification-facts-v1.js';

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

export type HistoryArchiveObjectDelayReasonCodeV1 =
	| 'archive-active-cap'
	| 'global-active-cap'
	| 'host-active-cap'
	| 'host-backoff'
	| 'legacy-deferred'
	| 'missing-dependency'
	| 'object-already-active'
	| 'planning-deferred'
	| 'retry-window';

export interface HistoryArchiveObjectErrorV1 {
	readonly message: string;
	readonly type: string;
	readonly httpStatus: number | null;
}

export interface HistoryArchiveObjectDelayReasonV1 {
	readonly code: HistoryArchiveObjectDelayReasonCodeV1;
	readonly until: string | null;
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
	readonly delayReason: HistoryArchiveObjectDelayReasonV1 | null;
	readonly nextAttemptAt: string | null;
	readonly refreshAfter: string | null;
	readonly claimedAt: string | null;
	readonly updatedAt: string;
	readonly verificationFacts: HistoryArchivePublicVerificationFactsV1 | null;
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

const HistoryArchivePublicCategorySummaryV1Schema: JSONSchemaType<HistoryArchivePublicCategorySummaryV1> =
	{
		type: 'object',
		properties: {
			entryCount: { type: 'number' },
			firstLedger: nullable({ type: 'number' }),
			lastLedger: nullable({ type: 'number' }),
			ledgerCount: { type: 'number' }
		},
		required: ['entryCount', 'firstLedger', 'lastLedger', 'ledgerCount'],
		additionalProperties: false
	};

export const HistoryArchivePublicVerificationFactsV1Schema: JSONSchemaType<HistoryArchivePublicVerificationFactsV1> =
	{
		type: 'object',
		properties: {
			bucketObject: {
				type: 'object',
				properties: {
					expectedBucketHash: { type: 'string' },
					hashAlgorithm: { type: 'string', enum: ['sha256'] },
					matched: { type: 'boolean', enum: [true] }
				},
				required: ['expectedBucketHash', 'hashAlgorithm', 'matched'],
				additionalProperties: false,
				nullable: true
			},
			checkpointHistoryArchiveStateFact: {
				type: 'object',
				properties: {
					bucketListHash: { type: 'string' },
					checkpointLedger: { type: 'number' },
					observedAt: { type: 'string', format: 'date-time' }
				},
				required: ['bucketListHash', 'checkpointLedger', 'observedAt'],
				additionalProperties: false,
				nullable: true
			},
			content: {
				type: 'object',
				properties: {
					algorithm: { type: 'string', enum: ['sha256'] },
					digest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
					representation: {
						type: 'string',
						enum: ['canonical-json', 'uncompressed-xdr']
					}
				},
				required: ['algorithm', 'digest', 'representation'],
				additionalProperties: false,
				nullable: true
			},
			ledgerCategory: {
				...HistoryArchivePublicCategorySummaryV1Schema,
				nullable: true
			},
			resultsCategory: {
				...HistoryArchivePublicCategorySummaryV1Schema,
				nullable: true
			},
			scpCategory: {
				type: 'object',
				properties: { entryCount: { type: 'number' } },
				required: ['entryCount'],
				additionalProperties: false,
				nullable: true
			},
			transactionsCategory: {
				...HistoryArchivePublicCategorySummaryV1Schema,
				nullable: true
			}
		},
		required: [],
		additionalProperties: false
	};

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

const HistoryArchiveObjectDelayReasonV1Schema: JSONSchemaType<HistoryArchiveObjectDelayReasonV1> =
	{
		type: 'object',
		properties: {
			code: {
				type: 'string',
				enum: [
					'archive-active-cap',
					'global-active-cap',
					'host-active-cap',
					'host-backoff',
					'legacy-deferred',
					'missing-dependency',
					'object-already-active',
					'planning-deferred',
					'retry-window'
				]
			},
			until: nullable({ type: 'string' })
		},
		required: ['code', 'until'],
		additionalProperties: false
	};

export const HistoryArchiveObjectV1Schema: JSONSchemaType<HistoryArchiveObjectV1> =
	{
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
			delayReason: nullable(HistoryArchiveObjectDelayReasonV1Schema),
			nextAttemptAt: nullable({ type: 'string' }),
			refreshAfter: nullable({ type: 'string' }),
			claimedAt: nullable({ type: 'string' }),
			updatedAt: { type: 'string' },
			verificationFacts: nullable(
				HistoryArchivePublicVerificationFactsV1Schema
			),
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
			'delayReason',
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
