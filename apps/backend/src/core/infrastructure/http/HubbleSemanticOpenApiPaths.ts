import {
	hubbleTransactionDescription,
	hubbleTransactionParameters,
	hubbleTransactionResponse
} from './HubbleTransactionOpenApi.js';
import type { OpenApiRecord } from './OpenApiDocumentProjection.js';

import {
	analyticsTag,
	publicAccess,
	errorResponse,
	transactionHashParameter,
	accountParameter,
	limitParameter,
	offsetParameter,
	minimumLedgerParameter,
	maximumLedgerParameter,
	transactionHashQueryParameter,
	ledgerSequenceParameter,
	operationIdParameter,
	contractIdParameter,
	assetParameter
} from './HubbleSemanticOpenApiParameters.js';
import {
	semanticResponse,
	holderNotFoundResponse
} from './HubbleSemanticOpenApiSchemas.js';

export const hubbleSemanticPaths: Readonly<Record<string, OpenApiRecord>> = {
	'/v1/analytics/ledgers/{sequence}': {
		get: {
			description:
				'Returns one decoded Hubble ledger in the currently ingested range.',
			operationId: 'getAnalyticsLedger',
			parameters: [ledgerSequenceParameter],
			responses: {
				'200': semanticResponse('getAnalyticsLedger'),
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
				'200': semanticResponse('listAnalyticsLedgerTransactions'),
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
				'200': semanticResponse('getAnalyticsOperation'),
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
			description:
				'Returns one page of decoded effects emitted by one operation. Follow nextOffset until null.',
			operationId: 'listAnalyticsOperationEffects',
			parameters: [operationIdParameter, limitParameter, offsetParameter],
			responses: {
				'200': semanticResponse('listAnalyticsOperationEffects'),
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
				'200': semanticResponse('listAnalyticsAccountEffects'),
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
				'200': semanticResponse('searchAnalyticsTrades'),
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
				'200': semanticResponse('listAnalyticsContractState'),
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
				'200': semanticResponse('listAnalyticsAssetTransfers'),
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
			description: hubbleTransactionDescription,
			operationId: 'getAnalyticsTransaction',
			parameters: [transactionHashParameter, ...hubbleTransactionParameters],
			responses: {
				'200': hubbleTransactionResponse,
				'400': errorResponse('The transaction hash is invalid.'),
				'404': errorResponse(
					'The transaction is outside the currently ingested range or does not exist.'
				),
				'500': errorResponse(
					'Unexpected transaction query failure (hubble_query_failed).'
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
				'200': semanticResponse('listAnalyticsAccountTransactions'),
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
				'200': semanticResponse('searchAnalyticsTransfers'),
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
				'Returns one page of source contract events, newest first. Classification separates classic, Soroban, fee and unknown provenance; a fee event alone is not Soroban execution evidence.',
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
				'200': semanticResponse('listAnalyticsContractEvents'),
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
				'Returns positive balances from each account’s latest published observation, optionally at or before as_of_ledger. Complete coverage requires continuous published history from the ledger-2 baseline through the selected ledger; otherwise results are partial or unknown. This is not a pinned current-chain snapshot. Balances retain source Float64 precision.',
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
					description:
						'Cursor returned as nextCursor. Reuse with unchanged asset, sort, order and as_of_ledger.',
					in: 'query',
					name: 'after',
					required: false,
					schema: { type: 'string' }
				},
				{
					description: 'Sort by account ID or balance.',
					in: 'query',
					name: 'sort',
					required: false,
					schema: {
						type: 'string',
						enum: ['account', 'balance'],
						default: 'account'
					}
				},
				{
					description:
						'Sort direction; balance ties always use account ID ascending.',
					in: 'query',
					name: 'order',
					required: false,
					schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' }
				},
				{
					description:
						'Optional positive ledger upper bound. State is reconstructed only from published observations at or before this ledger; coverageStatus reports whether history is continuous from the baseline.',
					in: 'query',
					name: 'as_of_ledger',
					required: false,
					schema: { type: 'integer', minimum: 1, maximum: 4294967295 }
				},
				limitParameter
			],
			responses: {
				'200': semanticResponse('listAnalyticsAssetHolders'),
				'400': errorResponse('The asset or cursor is invalid.'),
				'503': errorResponse('The analytics warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'List asset holders',
			tags: analyticsTag
		}
	},
	'/v1/analytics/assets/{asset}/holders/{account}': {
		get: {
			description:
				'Returns one account’s latest observed positive balance from completed batches, not a guarantee of current-chain state when history has gaps. Coverage and watermark identify cached catalog observations, not a pinned snapshot or historical as-of state.',
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
				'200': semanticResponse('getAnalyticsAssetHolder'),
				'400': errorResponse('The asset or account is invalid.'),
				'404': holderNotFoundResponse,
				'503': errorResponse('The analytics warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'Get one latest-ingested asset holder',
			tags: analyticsTag
		}
	}
};
