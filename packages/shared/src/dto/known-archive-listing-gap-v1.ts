import type { JSONSchemaType } from 'ajv';
import { nullable } from './helper/nullable.js';

/** Listing evidence, not individual HTTP failures or verified source checkpoints. */
export interface KnownArchiveListingGapV1 {
	readonly kind: 'gcs-listing-gap' | 's3-listing-gap' | 'directory-listing-gap';
	readonly firstCheckpointLedger: number;
	readonly lastCheckpointLedger: number;
	readonly resumeCheckpointLedger: number;
	readonly checkpointCount: number;
	readonly observedAt: string;
	readonly sourceCheckpointProofId: string | null;
	readonly sourceArchiveUrlIdentity: string | null;
	readonly listings: readonly {
		readonly category: 'history' | 'ledger' | 'transactions' | 'results';
		readonly listingUrl: string;
		readonly responseSha256: string;
		readonly firstReturnedKey: string | null;
		readonly firstReturnedCheckpoint: number | null;
		readonly completePrefix?: string;
		readonly rangeThroughCheckpoint?: number;
	}[];
}

export const KnownArchiveListingGapV1Schema: JSONSchemaType<KnownArchiveListingGapV1> =
	{
		type: 'object',
		additionalProperties: false,
		properties: {
			kind: {
				type: 'string',
				enum: ['gcs-listing-gap', 's3-listing-gap', 'directory-listing-gap']
			},
			firstCheckpointLedger: { type: 'integer', minimum: 63 },
			lastCheckpointLedger: { type: 'integer', minimum: 63 },
			resumeCheckpointLedger: { type: 'integer', minimum: 127 },
			checkpointCount: { type: 'integer', minimum: 1 },
			observedAt: { type: 'string', format: 'date-time' },
			sourceCheckpointProofId: nullable({
				type: 'string',
				pattern: '^[0-9]+$'
			}),
			sourceArchiveUrlIdentity: nullable({
				type: 'string',
				format: 'uri',
				pattern: '^https?://'
			}),
			listings: {
				type: 'array',
				minItems: 4,
				maxItems: 4,
				items: {
					type: 'object',
					additionalProperties: false,
					properties: {
						category: {
							type: 'string',
							enum: ['history', 'ledger', 'transactions', 'results']
						},
						listingUrl: {
							type: 'string',
							format: 'uri',
							maxLength: 4096,
							pattern: '^https?://'
						},
						responseSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
						firstReturnedKey: nullable({ type: 'string', maxLength: 2048 }),
						firstReturnedCheckpoint: nullable({ type: 'integer', minimum: 63 }),
						completePrefix: { type: 'string', nullable: true, maxLength: 2048 },
						rangeThroughCheckpoint: {
							type: 'integer',
							nullable: true,
							minimum: 63
						}
					},
					required: [
						'category',
						'listingUrl',
						'responseSha256',
						'firstReturnedKey',
						'firstReturnedCheckpoint'
					]
				}
			}
		},
		required: [
			'kind',
			'firstCheckpointLedger',
			'lastCheckpointLedger',
			'resumeCheckpointLedger',
			'checkpointCount',
			'observedAt',
			'sourceCheckpointProofId',
			'sourceArchiveUrlIdentity',
			'listings'
		]
	};
