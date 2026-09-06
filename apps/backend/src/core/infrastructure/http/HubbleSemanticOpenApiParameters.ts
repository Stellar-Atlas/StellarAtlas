import type { OpenApiRecord } from './OpenApiDocumentProjection.js';

export const analyticsTag = ['Analytics'];
export const publicAccess: readonly OpenApiRecord[] = [];
export const errorResponse = (description: string): OpenApiRecord => ({
	content: {
		'application/json': {
			schema: {
				additionalProperties: false,
				properties: {
					code: { type: 'string' },
					error: { type: 'string' }
				},
				required: ['code', 'error'],
				type: 'object'
			}
		}
	},
	description
});
export const transactionHashParameter: OpenApiRecord = {
	description: '64-character hexadecimal Stellar transaction hash.',
	in: 'path',
	name: 'transactionHash',
	required: true,
	schema: { pattern: '^[0-9a-fA-F]{64}$', type: 'string', example: '446670351d9f2af449eda3bfa0e36c3e128e2720443293dd5b585b3bbadeb485' }
};
export const accountParameter: OpenApiRecord = {
	description: 'Stellar G, M, or C address.',
	in: 'path',
	name: 'account',
	required: true,
	schema: { pattern: '^[GMC][A-Z2-7]{55,68}$', type: 'string' }
};
export const limitParameter: OpenApiRecord = {
	description: 'Maximum rows returned.',
	in: 'query',
	name: 'limit',
	required: false,
	schema: { default: 100, maximum: 200, minimum: 1, type: 'integer' }
};
export const offsetParameter: OpenApiRecord = {
	description: 'Zero-based row offset. Follow nextOffset when present.',
	in: 'query',
	name: 'offset',
	required: false,
	schema: { default: 0, minimum: 0, type: 'integer' }
};
export const minimumLedgerParameter: OpenApiRecord = {
	description: 'Inclusive minimum ledger sequence.',
	in: 'query',
	name: 'min_ledger',
	required: false,
	schema: { minimum: 1, type: 'integer' }
};
export const maximumLedgerParameter: OpenApiRecord = {
	description: 'Inclusive maximum ledger sequence.',
	in: 'query',
	name: 'max_ledger',
	required: false,
	schema: { minimum: 1, type: 'integer' }
};
export const transactionHashQueryParameter: OpenApiRecord = {
	description: 'Restrict results to one transaction hash.',
	in: 'query',
	name: 'transaction_hash',
	required: false,
	schema: { pattern: '^[0-9a-fA-F]{64}$', type: 'string' }
};

export const ledgerSequenceParameter: OpenApiRecord = {
	description: 'Ledger sequence in the currently ingested Hubble range.',
	in: 'path',
	name: 'sequence',
	required: true,
	schema: { minimum: 1, type: 'integer' }
};
export const operationIdParameter: OpenApiRecord = {
	description: 'Lossless decimal Stellar operation identifier.',
	in: 'path',
	name: 'operationId',
	required: true,
	schema: { pattern: '^[0-9]{1,20}$', type: 'string' }
};
export const contractIdParameter: OpenApiRecord = {
	description: 'Stellar C-address for a Soroban contract.',
	in: 'path',
	name: 'contractId',
	required: true,
	schema: { pattern: '^C[A-Z2-7]{55}$', type: 'string' }
};
export const assetParameter: OpenApiRecord = {
	description: 'native or URL-encoded CODE:ISSUER.',
	in: 'path',
	name: 'asset',
	required: true,
	schema: { example: 'native', type: 'string' }
};
