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

const ledgerSequenceParameter: OpenApiRecord = {
	description: 'Ledger sequence in the currently ingested Hubble range.',
	in: 'path',
	name: 'sequence',
	required: true,
	schema: { minimum: 1, type: 'integer' }
};
const operationIdParameter: OpenApiRecord = {
	description: 'Lossless decimal Stellar operation identifier.',
	in: 'path',
	name: 'operationId',
	required: true,
	schema: { pattern: '^[0-9]{1,20}$', type: 'string' }
};
const contractIdParameter: OpenApiRecord = {
	description: 'Stellar C-address for a Soroban contract.',
	in: 'path',
	name: 'contractId',
	required: true,
	schema: { pattern: '^C[A-Z2-7]{55}$', type: 'string' }
};
const assetParameter: OpenApiRecord = {
	description: 'native or URL-encoded CODE:ISSUER.',
	in: 'path',
	name: 'asset',
	required: true,
	schema: { example: 'native', type: 'string' }
};

export const hubbleSemanticPaths: Readonly<Record<string, OpenApiRecord>> = {
	'/v1/analytics/ledgers/{sequence}': {
		get: {
			description:
				'Returns one decoded Hubble ledger in the currently ingested range.',
			operationId: 'getAnalyticsLedger',
			parameters: [ledgerSequenceParameter],
			responses: {
				'200': objectResponse,
				'400': errorResponse('The ledger sequence is invalid.'),
				'404': errorResponse('The ledger is outside the ingested range.'),
				'503': errorResponse('The analytics warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'Locate a ledger',
			tags: analyticsTag
		}
	},
	'/v1/analytics/ledgers/{sequence}/transactions': {
		get: {
			description:
				'Returns decoded transactions in one ledger with explicit offset pagination.',
			operationId: 'listAnalyticsLedgerTransactions',
			parameters: [ledgerSequenceParameter, limitParameter, offsetParameter],
			responses: {
				'200': objectResponse,
				'400': errorResponse('The ledger or pagination input is invalid.'),
				'503': errorResponse('The analytics warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'List transactions in a ledger',
			tags: analyticsTag
		}
	},
	'/v1/analytics/operations/{operationId}': {
		get: {
			description:
				'Locates one operation and returns its decoded operation, transaction, and effects.',
			operationId: 'getAnalyticsOperation',
			parameters: [operationIdParameter],
			responses: {
				'200': objectResponse,
				'400': errorResponse('The operation identifier is invalid.'),
				'404': errorResponse('The operation is outside the ingested range.'),
				'503': errorResponse('The analytics warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'Locate an operation',
			tags: analyticsTag
		}
	},
	'/v1/analytics/operations/{operationId}/effects': {
		get: {
			description: 'Returns every decoded effect emitted by one operation.',
			operationId: 'listAnalyticsOperationEffects',
			parameters: [operationIdParameter, limitParameter, offsetParameter],
			responses: {
				'200': objectResponse,
				'400': errorResponse('The operation or pagination input is invalid.'),
				'503': errorResponse('The analytics warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'List operation effects',
			tags: analyticsTag
		}
	},
	'/v1/analytics/accounts/{account}/effects': {
		get: {
			description:
				'Returns decoded effects attributed to one account, newest first.',
			operationId: 'listAnalyticsAccountEffects',
			parameters: [
				accountParameter,
				minimumLedgerParameter,
				maximumLedgerParameter,
				limitParameter,
				offsetParameter
			],
			responses: {
				'200': objectResponse,
				'400': errorResponse(
					'The account, ledger range, or pagination input is invalid.'
				),
				'503': errorResponse('The analytics warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'List account effects',
			tags: analyticsTag
		}
	},
	'/v1/analytics/trades': {
		get: {
			description:
				'Searches decoded trades by participant, asset, pool, and ledger range.',
			operationId: 'searchAnalyticsTrades',
			parameters: [
				{
					description: 'Exact selling account.',
					in: 'query',
					name: 'seller',
					required: false,
					schema: { type: 'string' }
				},
				{
					description: 'Exact buying account.',
					in: 'query',
					name: 'buyer',
					required: false,
					schema: { type: 'string' }
				},
				{
					in: 'query',
					name: 'selling_asset_code',
					required: false,
					schema: { type: 'string' }
				},
				{
					in: 'query',
					name: 'selling_asset_issuer',
					required: false,
					schema: { type: 'string' }
				},
				{
					in: 'query',
					name: 'buying_asset_code',
					required: false,
					schema: { type: 'string' }
				},
				{
					in: 'query',
					name: 'buying_asset_issuer',
					required: false,
					schema: { type: 'string' }
				},
				{
					in: 'query',
					name: 'liquidity_pool_id',
					required: false,
					schema: { type: 'string' }
				},
				minimumLedgerParameter,
				maximumLedgerParameter,
				limitParameter,
				offsetParameter
			],
			responses: {
				'200': objectResponse,
				'400': errorResponse('A trade filter is invalid.'),
				'503': errorResponse('The analytics warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'Search trades',
			tags: analyticsTag
		}
	},
	'/v1/analytics/contracts/{contractId}/state': {
		get: {
			description:
				'Returns decoded Soroban contract-data changes for one contract. Optional filters select a ledger key, durability, deletion state, and ledger range.',
			operationId: 'listAnalyticsContractState',
			parameters: [
				contractIdParameter,
				{
					in: 'query',
					name: 'ledger_key_hash',
					required: false,
					schema: { type: 'string' }
				},
				{
					in: 'query',
					name: 'durability',
					required: false,
					schema: { type: 'string' }
				},
				{
					in: 'query',
					name: 'deleted',
					required: false,
					schema: { type: 'boolean' }
				},
				minimumLedgerParameter,
				maximumLedgerParameter,
				limitParameter,
				offsetParameter
			],
			responses: {
				'200': objectResponse,
				'400': errorResponse('The contract or state filter is invalid.'),
				'503': errorResponse('The analytics warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'List Soroban contract state changes',
			tags: analyticsTag
		}
	},
	'/v1/analytics/assets/{asset}/transfers': {
		get: {
			description:
				'Returns decoded transfers for native or CODE:ISSUER, with optional sender, recipient, transaction, and ledger filters.',
			operationId: 'listAnalyticsAssetTransfers',
			parameters: [
				assetParameter,
				{
					in: 'query',
					name: 'from',
					required: false,
					schema: { type: 'string' }
				},
				{
					in: 'query',
					name: 'to',
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
				'400': errorResponse('The asset or transfer filter is invalid.'),
				'503': errorResponse('The analytics warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'List asset transfers',
			tags: analyticsTag
		}
	},

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
