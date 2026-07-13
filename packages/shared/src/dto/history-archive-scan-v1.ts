import type { JSONSchemaType } from 'ajv';
import { nullable } from './helper/nullable.js';

export interface HistoryArchiveScanV1 {
	readonly url: string;
	readonly startDate: string;
	readonly endDate: string;
	readonly latestVerifiedLedger: number;
	readonly hasError: boolean;
	readonly errorUrl: string | null;
	readonly errorMessage: string | null;
	readonly isSlow: boolean;
	readonly errors: readonly HistoryArchiveScanErrorV1[];
	readonly archiveMetadata: HistoryArchiveMetadataV1 | null;
}

export interface HistoryArchiveScanErrorV1 {
	readonly type: string;
	readonly url: string;
	readonly message: string;
}

export interface HistoryArchiveMetadataV1 {
	readonly stellarHistoryUrl: string;
	readonly stellarHistory: HistoryArchiveStateV1;
	readonly observedAt: string;
}

export interface HistoryArchiveStateV1 {
	readonly version: number;
	readonly server: string;
	readonly currentLedger: number;
	readonly networkPassphrase?: string | null;
	readonly currentBuckets: readonly HistoryStateBucketV1[];
	readonly hotArchiveBuckets?: readonly HistoryStateBucketV1[];
}

export interface HistoryStateBucketV1 {
	readonly curr: string;
	readonly snap: string;
	readonly next: {
		readonly state: number;
		readonly output?: string | null;
	};
}

export const HistoryStateBucketV1Schema: JSONSchemaType<HistoryStateBucketV1> =
	{
		type: 'object',
		properties: {
			curr: {
				type: 'string'
			},
			snap: {
				type: 'string'
			},
			next: {
				type: 'object',
				properties: {
					state: {
						type: 'number'
					},
					output: {
						type: 'string',
						nullable: true
					}
				},
				required: ['state'],
				additionalProperties: false
			}
		},
		required: ['curr', 'snap', 'next'],
		additionalProperties: false
	};

export const HistoryArchiveStateV1Schema: JSONSchemaType<HistoryArchiveStateV1> =
	{
		type: 'object',
		properties: {
			version: {
				type: 'number'
			},
			server: {
				type: 'string'
			},
			currentLedger: {
				type: 'number'
			},
			networkPassphrase: {
				type: 'string',
				nullable: true
			},
			currentBuckets: {
				type: 'array',
				items: HistoryStateBucketV1Schema
			},
			hotArchiveBuckets: {
				type: 'array',
				nullable: true,
				items: HistoryStateBucketV1Schema
			}
		},
		required: ['version', 'server', 'currentLedger', 'currentBuckets'],
		additionalProperties: false
	};

export const HistoryArchiveScanV1Schema: JSONSchemaType<HistoryArchiveScanV1> =
	{
		$id: 'history-scan-v1.json',
		$schema: 'http://json-schema.org/draft-07/schema#',
		properties: {
			startDate: {
				format: 'date-time',
				type: 'string'
			},
			endDate: {
				format: 'date-time',
				type: 'string'
			},
			url: {
				type: 'string'
			},
			latestVerifiedLedger: {
				type: 'number'
			},
			hasError: {
				type: 'boolean'
			},
			errorUrl: nullable({
				type: 'string'
			}),
			errorMessage: nullable({
				type: 'string'
			}),
			isSlow: {
				type: 'boolean'
			},
			errors: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						type: {
							type: 'string'
						},
						url: {
							type: 'string'
						},
						message: {
							type: 'string'
						}
					},
					required: ['type', 'url', 'message'],
					additionalProperties: false
				}
			},
			archiveMetadata: nullable({
				type: 'object',
				properties: {
					stellarHistoryUrl: {
						type: 'string'
					},
					stellarHistory: HistoryArchiveStateV1Schema,
					observedAt: {
						format: 'date-time',
						type: 'string'
					}
				},
				required: ['stellarHistoryUrl', 'stellarHistory', 'observedAt'],
				additionalProperties: false
			})
		},
		type: 'object',
		required: [
			'url',
			'startDate',
			'endDate',
			'hasError',
			'latestVerifiedLedger',
			'isSlow',
			'errorUrl',
			'errorMessage',
			'errors',
			'archiveMetadata'
		]
	};
