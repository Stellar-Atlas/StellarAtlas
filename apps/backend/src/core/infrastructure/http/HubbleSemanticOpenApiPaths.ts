import type { OpenApiRecord } from './OpenApiDocumentProjection.js';

const analyticsTag = ['Analytics'];
const publicAccess: readonly OpenApiRecord[] = [];
const objectResponse: OpenApiRecord = {
	content: {
		'application/json': {
			schema: { additionalProperties: true, type: 'object' }
		}
	},
	description: 'Analytics result.'
};
const errorResponse = (description: string): OpenApiRecord => ({
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
const transactionHashParameter: OpenApiRecord = {
	description: '64-character hexadecimal Stellar transaction hash.',
	in: 'path',
	name: 'transactionHash',
	required: true,
	schema: { pattern: '^[0-9a-fA-F]{64}$', type: 'string' }
};
const accountParameter: OpenApiRecord = {
	description: 'Stellar G, M, or C address.',
	in: 'path',
	name: 'account',
	required: true,
	schema: { pattern: '^[GMC][A-Z2-7]{55,68}$', type: 'string' }
};
const limitParameter: OpenApiRecord = {
	description: 'Maximum rows returned.',
	in: 'query',
	name: 'limit',
	required: false,
	schema: { default: 100, maximum: 200, minimum: 1, type: 'integer' }
};
const offsetParameter: OpenApiRecord = {
	description: 'Zero-based row offset. Follow nextOffset when present.',
	in: 'query',
	name: 'offset',
	required: false,
	schema: { default: 0, minimum: 0, type: 'integer' }
};
const minimumLedgerParameter: OpenApiRecord = {
	description: 'Inclusive minimum ledger sequence.',
	in: 'query',
	name: 'min_ledger',
	required: false,
	schema: { minimum: 1, type: 'integer' }
};
const maximumLedgerParameter: OpenApiRecord = {
	description: 'Inclusive maximum ledger sequence.',
	in: 'query',
	name: 'max_ledger',
	required: false,
	schema: { minimum: 1, type: 'integer' }
};
const transactionHashQueryParameter: OpenApiRecord = {
	description: 'Restrict results to one transaction hash.',
	in: 'query',
	name: 'transaction_hash',
	required: false,
	schema: { pattern: '^[0-9a-fA-F]{64}$', type: 'string' }
};

export const hubbleSemanticPaths: Readonly<Record<string, OpenApiRecord>> = {
	'/v1/analytics/transactions/{transactionHash}': {
		get: {
			description:
				'Locates a transaction by hash and returns its decoded transaction, ledger, operations, contract events, and token transfers.',
			operationId: 'getAnalyticsTransaction',
			parameters: [transactionHashParameter],
			responses: {
				'200': objectResponse,
				'400': errorResponse('The transaction hash is invalid.'),
				'404': errorResponse(
					'The transaction is outside the currently ingested range or does not exist.'
				),
				'503': errorResponse('The analytics warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'Locate a transaction',
			tags: analyticsTag
		}
	},
	'/v1/analytics/accounts/{account}/transactions': {
		get: {
			description:
				'Returns transactions sourced by the account or linked through an operation effect, newest first.',
			operationId: 'listAnalyticsAccountTransactions',
			parameters: [accountParameter, limitParameter, offsetParameter],
			responses: {
				'200': objectResponse,
				'400': errorResponse('The account or pagination input is invalid.'),
				'503': errorResponse('The analytics warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'List account transaction activity',
			tags: analyticsTag
		}
	},
	'/v1/analytics/transfers': {
		get: {
			description:
				'Searches decoded classic and contract token transfers. All supplied filters are combined.',
			operationId: 'searchAnalyticsTransfers',
			parameters: [
				{
					description: 'Exact sender address.',
					in: 'query',
					name: 'from',
					required: false,
					schema: { type: 'string' }
				},
				{
					description: 'Exact recipient address.',
					in: 'query',
					name: 'to',
					required: false,
					schema: { type: 'string' }
				},
				{
					description: 'Exact normalized asset identifier.',
					in: 'query',
					name: 'asset',
					required: false,
					schema: { type: 'string' }
				},
				{
					description: 'Classic asset code.',
					in: 'query',
					name: 'asset_code',
					required: false,
					schema: { maxLength: 12, type: 'string' }
				},
				{
					description: 'Classic asset issuer.',
					in: 'query',
					name: 'asset_issuer',
					required: false,
					schema: { type: 'string' }
				},
				{
					description: 'Soroban token contract address.',
					in: 'query',
					name: 'contract_id',
					required: false,
					schema: { type: 'string' }
				},
				transactionHashQueryParameter,
				minimumLedgerParameter,
				maximumLedgerParameter,
				limitParameter,
				offsetParameter
			],
			responses: {
				'200': objectResponse,
				'400': errorResponse('A transfer filter is invalid.'),
				'503': errorResponse('The analytics warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'Search token transfers',
			tags: analyticsTag
		}
	},
	'/v1/analytics/contracts/{contractId}/events': {
		get: {
			description:
				'Returns decoded Soroban contract events for one contract, newest first.',
			operationId: 'listAnalyticsContractEvents',
			parameters: [
				{
					description: 'Stellar C-address for a Soroban contract.',
					in: 'path',
					name: 'contractId',
					required: true,
					schema: { pattern: '^C[A-Z2-7]{55}$', type: 'string' }
				},
				transactionHashQueryParameter,
				minimumLedgerParameter,
				maximumLedgerParameter,
				limitParameter,
				offsetParameter
			],
			responses: {
				'200': objectResponse,
				'400': errorResponse('The contract or filter is invalid.'),
				'503': errorResponse('The analytics warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'List contract events',
			tags: analyticsTag
		}
	},
	'/v1/analytics/assets/{asset}/holders': {
		get: {
			description:
				'Returns current positive-balance holders as of the latest ingested ledger. Use native or URL-encoded CODE:ISSUER.',
			operationId: 'listAnalyticsAssetHolders',
			parameters: [
				{
					description: 'native or CODE:ISSUER.',
					in: 'path',
					name: 'asset',
					required: true,
					schema: { example: 'native', type: 'string' }
				},
				{
					description: 'Account cursor returned as nextCursor.',
					in: 'query',
					name: 'after',
					required: false,
					schema: { type: 'string' }
				},
				limitParameter
			],
			responses: {
				'200': objectResponse,
				'400': errorResponse('The asset or cursor is invalid.'),
				'503': errorResponse('The analytics warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'List current asset holders',
			tags: analyticsTag
		}
	},
	'/v1/analytics/assets/{asset}/holders/{account}': {
		get: {
			description:
				'Returns one account current balance for an asset as of the latest ingested ledger.',
			operationId: 'getAnalyticsAssetHolder',
			parameters: [
				{
					description: 'native or CODE:ISSUER.',
					in: 'path',
					name: 'asset',
					required: true,
					schema: { example: 'native', type: 'string' }
				},
				accountParameter
			],
			responses: {
				'200': objectResponse,
				'400': errorResponse('The asset or account is invalid.'),
				'404': errorResponse(
					'The account has no current positive balance in the ingested range.'
				),
				'503': errorResponse('The analytics warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'Get one current asset holder',
			tags: analyticsTag
		}
	}
};
