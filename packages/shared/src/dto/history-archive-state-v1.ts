import type { JSONSchemaType } from 'ajv';
import {
	HistoryArchiveStateV1Schema,
	type HistoryArchiveMetadataV1
} from './history-archive-scan-v1.js';
import { nullable } from './helper/nullable.js';

export type HistoryArchiveStateStatusV1 =
	'available' | 'invalid' | 'unreachable';

export type HistoryArchiveStateSourceV1 =
	'backfill' | 'history-scanner' | 'network-scan';

export interface HistoryArchiveStateFailureV1 {
	readonly message: string;
	readonly type: string;
	readonly httpStatus: number | null;
}

export interface HistoryArchiveStateLatestFailureV1 extends HistoryArchiveStateFailureV1 {
	readonly observedAt: string;
	readonly source: HistoryArchiveStateSourceV1;
}

export interface HistoryArchiveStateSnapshotV1 {
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
	readonly stateUrl: string;
	readonly status: HistoryArchiveStateStatusV1;
	readonly observedAt: string;
	readonly source: HistoryArchiveStateSourceV1;
	readonly metadata: HistoryArchiveMetadataV1 | null;
	readonly failure: HistoryArchiveStateFailureV1 | null;
	readonly latestFailure: HistoryArchiveStateLatestFailureV1 | null;
}

const HistoryArchiveStateFailureV1Schema: JSONSchemaType<HistoryArchiveStateFailureV1> =
	{
		type: 'object',
		properties: {
			message: {
				type: 'string'
			},
			type: {
				type: 'string'
			},
			httpStatus: nullable({
				type: 'number'
			})
		},
		required: ['message', 'type', 'httpStatus'],
		additionalProperties: false
	};

const HistoryArchiveStateLatestFailureV1Schema: JSONSchemaType<HistoryArchiveStateLatestFailureV1> =
	{
		type: 'object',
		properties: {
			message: {
				type: 'string'
			},
			type: {
				type: 'string'
			},
			httpStatus: nullable({
				type: 'number'
			}),
			observedAt: {
				type: 'string',
				format: 'date-time'
			},
			source: {
				type: 'string',
				enum: ['backfill', 'history-scanner', 'network-scan']
			}
		},
		required: ['message', 'type', 'httpStatus', 'observedAt', 'source'],
		additionalProperties: false
	};

const HistoryArchiveMetadataV1Schema: JSONSchemaType<HistoryArchiveMetadataV1> =
	{
		type: 'object',
		properties: {
			stellarHistoryUrl: {
				type: 'string'
			},
			stellarHistory: HistoryArchiveStateV1Schema,
			observedAt: {
				type: 'string',
				format: 'date-time'
			}
		},
		required: ['stellarHistoryUrl', 'stellarHistory', 'observedAt'],
		additionalProperties: false
	};

export const HistoryArchiveStateSnapshotV1Schema: JSONSchemaType<HistoryArchiveStateSnapshotV1> =
	{
		$id: 'history-archive-state-v1.json',
		$schema: 'http://json-schema.org/draft-07/schema#',
		type: 'object',
		properties: {
			archiveUrl: {
				type: 'string'
			},
			archiveUrlIdentity: {
				type: 'string'
			},
			stateUrl: {
				type: 'string'
			},
			status: {
				type: 'string',
				enum: ['available', 'invalid', 'unreachable']
			},
			observedAt: {
				type: 'string',
				format: 'date-time'
			},
			source: {
				type: 'string',
				enum: ['backfill', 'history-scanner', 'network-scan']
			},
			metadata: nullable(HistoryArchiveMetadataV1Schema),
			failure: nullable(HistoryArchiveStateFailureV1Schema),
			latestFailure: nullable(HistoryArchiveStateLatestFailureV1Schema)
		},
		required: [
			'archiveUrl',
			'archiveUrlIdentity',
			'stateUrl',
			'status',
			'observedAt',
			'source',
			'metadata',
			'failure',
			'latestFailure'
		],
		additionalProperties: false
	};
