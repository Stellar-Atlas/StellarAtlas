import type { OpenApiRecord } from './OpenApiDocumentProjection.js';
import { array, object, ref, text } from './HubbleOpenApiSchemas.js';

export const hubbleGraphqlSchemas: Record<string, OpenApiRecord> = {
	HubbleGraphqlRequest: object({
		query: { type: 'string', description: 'Read-only GraphQL query. Introspection is available; mutations and subscriptions are not defined.' },
		operationName: { type: 'string', nullable: true },
		variables: { type: 'object', additionalProperties: true, nullable: true }
	}, ['query']),
	HubbleGraphqlResponse: object({
		data: { type: 'object', additionalProperties: true, nullable: true, description: 'Fields selected by the query; typed transaction, transfer, contract-event, trade, offer and asset-holder fields use their documented GraphQL types.' },
		errors: array(object({
			message: text,
			locations: array(object({ line: { type: 'integer' }, column: { type: 'integer' } })),
			path: array({ oneOf: [text, { type: 'integer' }] }),
			extensions: { type: 'object', additionalProperties: true }
		}, ['message']))
	}, [])
};
const examples: OpenApiRecord = {
 assetHolders: {
  summary: 'Latest-ingested asset holders with source Float64 balances and coverage',
  value: { query: 'query Holders($asset:String!,$input:HubbleAssetHolderInput) { hubbleAssetHolders(asset:$asset,input:$input) { holders { accountId balance amountPrecision buyingLiabilities sellingLiabilities } nextCursor limit coverage { contiguousLastLedger maximumLedger gapCount } watermark { mode catalogGeneratedAt catalogMaximumLedger snapshotPinned } } }', variables: { asset: 'native', input: { limit: 10 } } }
 },
 contractEvents: {
  summary: 'Historical contract diagnostics with typed cursor pagination',
  value: { query: 'query Events($after: String) { hubbleContractEvents(contractId: "CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA", input: {minLedger:63490364,maxLedger:63490364,typeCode:2,successful:false,limit:2,after:$after}) { items { id transactionHash typeCode successful topicsJson dataJson eventXdr classification { transactionKind eventKind sorobanExecutionEvidence provenance } } nextCursor watermark { minimumLedger maximumLedger observedAt coverage } coverage { contiguousLastLedger maximumLedger gapCount } } }', variables: { after: null } }
 },
 trades: {
  summary: 'Parsed trades: source Float64 amounts are disclosed, not exact decimal reconstruction',
  value: { query: '{ hubbleTrades(input: {minLedger:63490364,maxLedger:63490364,limit:2}) { rows { id operationId sellingAmount buyingAmount amountPrecision price { numerator denominator } sellingAsset { id code issuer } buyingAsset { id code issuer } } nextOffset coverageStatus semantics } }' }
 },
 offers: {
  summary: 'Offer observations in one ledger, not a complete live order book',
  value: { query: '{ hubbleOffer(id:"1848813589",input:{minLedger:63490364,maxLedger:63490364}) { record { id seller amount amountPrecision deleted price { numerator denominator } } coverageStatus semantics } }' }
 },
	coverage: {
		summary: 'Current parsed coverage (metadata only)',
		value: { query: '{ hubbleStatus { servingWarehouse coverage { contiguousFirstLedger contiguousLastLedger supplementalLedgerCount maximumLedger gapCount } } }' }
	},
	transaction: {
		summary: 'Typed transaction with independent relationship cursors',
		value: {
			query: 'query Transaction($hash: String!, $ledger: Int, $limit: Int, $operationsAfter: String, $effectsAfter: String, $eventsAfter: String) { hubbleTransaction(transactionHash: $hash, ledgerSequence: $ledger, limit: $limit, operationsAfter: $operationsAfter, effectsAfter: $effectsAfter, eventsAfter: $eventsAfter) { transaction { id hash ledgerSequence feeChargedRaw } operations { items { id type amounts { field raw scale } } nextCursor } effects { items { id operationId type } nextCursor } events { items { id classification { transactionKind eventKind provenance } } nextCursor } } }',
			variables: { hash: '446670351d9f2af449eda3bfa0e36c3e128e2720443293dd5b585b3bbadeb485', ledger: 63490364, limit: 10 }
		}
	}
};
const response = {
	description: 'GraphQL response. Inspect errors even on HTTP 200; execution errors can coexist with partial or null data.',
	content: {
		'application/json': { schema: ref('HubbleGraphqlResponse') },
		'application/graphql-response+json': { schema: ref('HubbleGraphqlResponse') }
	}
};
export const hubbleGraphqlPaths: Record<string, OpenApiRecord> = {
	'/graphql': {
		post: {
			operationId: 'postAnalyticsGraphql',
			summary: 'Run a read-only GraphQL query',
			description: 'Typed hubbleTransaction, hubbleTransfers, hubbleAccountTransfers and hubbleAssetTransfers share REST query services. hubbleDatasets, hubbleStatus and structured hubbleQuery are also available. Use schema introspection for complete field and argument definitions. Preserve separate nextCursor values for transaction operations, effects and events; transfers use after with unchanged filters. IDs and exact amounts are strings, never GraphQL Float. hubbleAssetHolders and hubbleAssetHolder reuse the REST holder service: native or CODE:ISSUER, after account-ID pagination, latest-ingested observations with cached coverage rather than an atomic/current/as-of state. HubbleParsedNumber preserves source numbers/strings; balance and liabilities have float64-observation precision, not exact reconstructed atomic units. No mutation schema is exposed.',
			tags: ['Analytics'],
			security: [],
			requestBody: { required: true, content: { 'application/json': { schema: ref('HubbleGraphqlRequest'), examples } } },
			responses: { '200': response, '400': response, '405': { description: 'Unsupported HTTP method.' }, '415': { description: 'Unsupported request content type; use application/json.' } }
		},
		get: {
			operationId: 'queryHubbleGraphqlGet',
			summary: 'Run a read-only GraphQL query using URL parameters',
			description: 'GET variant of the GraphQL transport. Prefer POST for long query documents or variables.',
			tags: ['Analytics'],
			security: [],
			parameters: [
				{ in: 'query', name: 'query', required: true, schema: text },
				{ in: 'query', name: 'operationName', required: false, schema: text },
				{ in: 'query', name: 'variables', required: false, schema: text, description: 'JSON-encoded object.' }
			],
			responses: { '200': response, '400': response, '405': { description: 'Only read-only queries are supported.' } }
		}
	}
};
