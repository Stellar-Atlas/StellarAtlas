import type { OpenApiRecord } from './OpenApiDocumentProjection.js';
import { array, object, ref, text } from './HubbleOpenApiSchemas.js';

export const hubbleGraphqlSchemas: Record<string, OpenApiRecord> = {
	HubbleGraphqlRequest: object({
		query: { type: 'string', description: 'Read-only GraphQL query. Introspection is available; mutations and subscriptions are not defined.' },
		operationName: { type: 'string', nullable: true },
		variables: { type: 'object', additionalProperties: true, nullable: true }
	}, ['query']),
	HubbleGraphqlResponse: object({
		data: { type: 'object', additionalProperties: true, nullable: true, description: 'Fields selected by the query; typed transaction and transfer fields use their documented GraphQL types.' },
		errors: array(object({
			message: text,
			locations: array(object({ line: { type: 'integer' }, column: { type: 'integer' } })),
			path: array({ oneOf: [text, { type: 'integer' }] }),
			extensions: { type: 'object', additionalProperties: true }
		}, ['message']))
	}, [])
};
const examples: OpenApiRecord = {
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
			description: 'Typed hubbleTransaction, hubbleTransfers, hubbleAccountTransfers and hubbleAssetTransfers share REST query services. hubbleDatasets, hubbleStatus and structured hubbleQuery are also available. Use schema introspection for complete field and argument definitions. Preserve separate nextCursor values for transaction operations, effects and events; transfers use after with unchanged filters. IDs and exact amounts are strings, never GraphQL Float. No mutation schema is exposed.',
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
