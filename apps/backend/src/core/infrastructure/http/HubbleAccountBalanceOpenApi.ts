import type { OpenApiRecord } from './OpenApiDocumentProjection.js';
import {
	array,
	integer,
	jsonResponse,
	nullableText,
	object,
	ref,
	text
} from './HubbleOpenApiSchemas.js';
import { holderEvidence } from './HubbleSemanticOpenApiSchemas.js';
import { errorResponse } from './HubbleSemanticOpenApiParameters.js';
export const hubbleAccountBalanceSchemas: Record<string, OpenApiRecord> = {
	HubbleAccountBalance: object({
		asset: text,
		assetType: {
			type: 'string',
			enum: ['native', 'credit_alphanum4', 'credit_alphanum12']
		},
		assetCode: nullableText,
		assetIssuer: nullableText,
		balance: {
			type: 'number',
			description:
				'Official Stellar ETL Float64 observation in asset units, not an exact decimal or atomic-unit amount.'
		},
		balanceRaw: {
			type: 'string',
			nullable: true,
			enum: [null],
			description:
				'Unavailable in these parsed source tables; never reconstructed from Float64.'
		},
		amountPrecision: { type: 'string', enum: ['float64-observation'] },
		buyingLiabilities: { type: 'number' },
		sellingLiabilities: { type: 'number' },
		trustLineLimitRaw: {
			...nullableText,
			pattern: '^[0-9]+$',
			description:
				'Exact signed64 source limit as a decimal integer string (atomic units), null for native.'
		},
		flags: integer,
		lastModifiedLedger: integer,
		observedLedger: integer
	}),
	HubbleAccountBalancePage: object({
		...holderEvidence,
		account: text,
		balanceScope: { type: 'string', enum: ['native-and-issued'] },
		balances: array(ref('HubbleAccountBalance')),
		elapsedMilliseconds: { type: 'number' },
		limit: integer,
		nextCursor: {
			...nullableText,
			description:
				'Opaque account-scoped keyset cursor. Pass unchanged as after; null ends the result. Native precedes issued assets sorted by code and issuer.'
		}
	})
};
export const hubbleAccountBalancePaths: Record<string, OpenApiRecord> = {
	'/v1/analytics/accounts/{account}/balances': {
		get: {
			operationId: 'listAnalyticsAccountBalances',
			summary: 'List one account’s latest-ingested balances',
			tags: ['Analytics'],
			security: [],
			description:
				'Reads native and issued-asset balances from completed parsed batches, including zero balances and honoring observed deletions. Liquidity-pool shares and arbitrary Soroban-token balances are outside this scope. Float64 source observations are not exact atomic amounts. Coverage is partial while ingestion continues and is not a pinned snapshot. An empty200 does not establish absence on the current chain. Only after and limit are supported; current/as-of ledger or time filters are rejected.',
			parameters: [
				{
					in: 'path',
					name: 'account',
					required: true,
					description: 'Checksum-valid Stellar Ed25519 G address.',
					schema: {
						type: 'string',
						pattern: '^G[A-Z2-7]{55}$',
						example: 'GASNOA72CECDUZ5GEUK6WFINSASEG6R3WYZB2DE2CGDU7YI7GC2QPSFX'
					}
				},
				{
					in: 'query',
					name: 'after',
					required: false,
					description:
						'Opaque nextCursor from the preceding page for this exact account.',
					schema: { type: 'string', maxLength: 512 }
				},
				{
					in: 'query',
					name: 'limit',
					required: false,
					schema: { type: 'integer', minimum: 1, maximum: 200, default: 100 }
				}
			],
			responses: {
				'200': jsonResponse(
					ref('HubbleAccountBalancePage'),
					'Latest ingested native and issued balances; an empty page is valid.'
				),
				'400': errorResponse(
					'Invalid account, cursor, limit or unsupported query parameter.'
				),
				'503': errorResponse('The parsed warehouse is unavailable.')
			}
		}
	}
};
