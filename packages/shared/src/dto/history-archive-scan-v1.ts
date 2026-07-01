import { JSONSchemaType } from 'ajv';
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
}

export interface HistoryArchiveScanErrorV1 {
	readonly type: string;
	readonly url: string;
	readonly message: string;
}

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
			}
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
			'errors'
		]
	};
