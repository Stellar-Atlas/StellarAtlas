import { JSONSchemaType } from 'ajv';
import { nullable } from './helper/nullable.js';
import type { HistoryArchiveObjectTypeV1 } from './history-archive-object-v1.js';

export type HistoryArchiveObjectEventTypeV1 =
	| 'claimed'
	| 'heartbeat'
	| 'verified'
	| 'failed'
	| 'released';

export type HistoryArchiveObjectEvidenceClassV1 =
	| 'archive-object'
	| 'worker-infrastructure'
	| 'coordinator-infrastructure';

export interface HistoryArchiveObjectEventV1 {
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
	readonly bucketHash: string | null;
	readonly bytesDownloaded: number | null;
	readonly checkpointLedger: number | null;
	readonly claimAttempt: number | null;
	readonly createdAt: string;
	readonly error: {
		readonly httpStatus: number | null;
		readonly message: string;
		readonly type: string;
	} | null;
	readonly eventType: HistoryArchiveObjectEventTypeV1;
	readonly evidenceClass: HistoryArchiveObjectEvidenceClassV1 | null;
	readonly nextAttemptAt: string | null;
	readonly objectKey: string;
	readonly objectRemoteId: string;
	readonly objectType: HistoryArchiveObjectTypeV1;
	readonly objectUrl: string;
	readonly remoteId: string;
	readonly verificationFacts: Readonly<Record<string, unknown>> | null;
	readonly workerStage: string | null;
}

export interface HistoryArchiveObjectEventsV1 {
	readonly count: number;
	readonly events: readonly HistoryArchiveObjectEventV1[];
	readonly generatedAt: string;
	readonly limit: number;
}

const HistoryArchiveObjectEventErrorV1Schema: JSONSchemaType<
	NonNullable<HistoryArchiveObjectEventV1['error']>
> = {
	type: 'object',
	properties: {
		httpStatus: nullable({ type: 'number' }),
		message: { type: 'string' },
		type: { type: 'string' }
	},
	required: ['httpStatus', 'message', 'type'],
	additionalProperties: false
};

const HistoryArchiveObjectEventV1Schema: JSONSchemaType<HistoryArchiveObjectEventV1> =
	{
		type: 'object',
		properties: {
			archiveUrl: { type: 'string' },
			archiveUrlIdentity: { type: 'string' },
			bucketHash: nullable({ type: 'string' }),
			bytesDownloaded: nullable({ type: 'number' }),
			checkpointLedger: nullable({ type: 'number' }),
			claimAttempt: nullable({ type: 'number' }),
			createdAt: { type: 'string' },
			error: nullable(HistoryArchiveObjectEventErrorV1Schema),
			eventType: {
				type: 'string',
				enum: ['claimed', 'heartbeat', 'verified', 'failed', 'released']
			},
			evidenceClass: nullable({
				type: 'string',
				enum: [
					'archive-object',
					'worker-infrastructure',
					'coordinator-infrastructure'
				]
			}),
			nextAttemptAt: nullable({ type: 'string' }),
			objectKey: { type: 'string' },
			objectRemoteId: { type: 'string' },
			objectType: {
				type: 'string',
				enum: [
					'history-archive-state',
					'checkpoint-state',
					'ledger',
					'transactions',
					'results',
					'bucket'
				]
			},
			objectUrl: { type: 'string' },
			remoteId: { type: 'string' },
			verificationFacts: nullable({
				type: 'object',
				additionalProperties: true,
				required: []
			}),
			workerStage: nullable({ type: 'string' })
		},
		required: [
			'archiveUrl',
			'archiveUrlIdentity',
			'bucketHash',
			'bytesDownloaded',
			'checkpointLedger',
			'claimAttempt',
			'createdAt',
			'error',
			'eventType',
			'evidenceClass',
			'nextAttemptAt',
			'objectKey',
			'objectRemoteId',
			'objectType',
			'objectUrl',
			'remoteId',
			'verificationFacts',
			'workerStage'
		],
		additionalProperties: false
	};

export const HistoryArchiveObjectEventsV1Schema: JSONSchemaType<HistoryArchiveObjectEventsV1> =
	{
		$id: 'history-archive-object-events-v1.json',
		$schema: 'http://json-schema.org/draft-07/schema#',
		type: 'object',
		properties: {
			count: { type: 'number' },
			events: {
				type: 'array',
				items: HistoryArchiveObjectEventV1Schema
			},
			generatedAt: { type: 'string', format: 'date-time' },
			limit: { type: 'number' }
		},
		required: ['count', 'events', 'generatedAt', 'limit'],
		additionalProperties: false
	};
