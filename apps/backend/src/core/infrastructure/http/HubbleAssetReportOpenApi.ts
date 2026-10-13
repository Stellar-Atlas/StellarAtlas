import type { OpenApiRecord } from './OpenApiDocumentProjection.js';
import {
	errorResponse,
	assetParameter,
	limitParameter,
	minimumLedgerParameter,
	maximumLedgerParameter,
	publicAccess,
	analyticsTag
} from './HubbleSemanticOpenApiParameters.js';
import {
	ref,
	jsonResponse,
	text,
	nullableText
} from './HubbleOpenApiSchemas.js';
import { hubbleSemanticSchemas } from './HubbleSemanticOpenApiSchemas.js';

const sourceNumber: OpenApiRecord = {
	oneOf: [text, { type: 'number' }],
	description:
		'Source ETL Float64 observation; not an exact decimal or atomic-unit amount.'
};
const sourceLedger: OpenApiRecord = {
	oneOf: [
		{ type: 'string', pattern: '^[1-9][0-9]*$' },
		{ type: 'integer', minimum: 1, maximum: 4294967295 }
	]
};
const common = [
	assetParameter,
	minimumLedgerParameter,
	maximumLedgerParameter,
	{
		in: 'query',
		name: 'start_time',
		required: false,
		description: 'Inclusive UTC timestamp ending in Z.',
		schema: { type: 'string', format: 'date-time' }
	},
	{
		in: 'query',
		name: 'end_time',
		required: false,
		description: 'Inclusive UTC timestamp ending in Z.',
		schema: { type: 'string', format: 'date-time' }
	},
	limitParameter,
	{
		in: 'query',
		name: 'after',
		required: false,
		description:
			'Opaque cursor bound to this selection and source-ledger window.',
		schema: { type: 'string', maxLength: 2048 }
	},
	{
		in: 'query',
		name: 'order',
		required: false,
		schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' }
	}
] as const;
const snapshotParameters: OpenApiRecord[] = [
	assetParameter,
	{
		in: 'query', name: 'account', required: false,
		description: 'Optional Stellar G, M, or C address filter.',
		schema: { type: 'string', pattern: '^[GMC][A-Z2-7]{55,68}$' }
	},
	{
		in: 'query', name: 'after', required: false,
		description: 'Opaque cursor returned as nextCursor; reuse with unchanged filters.',
		schema: { type: 'string', maxLength: 2048 }
	},
	limitParameter,
	{
		in: 'query', name: 'sort', required: false,
		schema: { type: 'string', enum: ['account', 'balance'], default: 'account' }
	},
	{
		in: 'query', name: 'order', required: false,
		schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' }
	},
	{
		in: 'query', name: 'as_of_ledger', required: false,
		description: 'Optional positive ledger upper bound.',
		schema: { type: 'integer', minimum: 1, maximum: 4294967295 }
	},
	{
		in: 'query', name: 'include_deleted', required: false,
		schema: { type: 'boolean', default: false }
	}
];
const snapshotPage = (dataset: 'asset_balances' | 'asset_trustlines'): OpenApiRecord => {
	const holderPage = hubbleSemanticSchemas.HubbleHolderPage;
	return {
		...holderPage,
		description: 'Latest-ingested holder-index snapshot; source Float64 precision and non-pinned coverage/watermark are retained.',
		properties: { ...(holderPage.properties as OpenApiRecord), dataset: { type: 'string', enum: [dataset] } },
		required: [...(holderPage.required as string[]), 'dataset']
	};
};
function op(
	operationId: string,
	summary: string,
	description: string,
	parameters: readonly OpenApiRecord[],
	schema: OpenApiRecord,
	badRequestDescription = 'Invalid asset, range, filter, or cursor.'
): OpenApiRecord {
	return {
		get: {
			operationId,
			summary,
			description,
			parameters,
			security: publicAccess,
			tags: analyticsTag,
			responses: {
				'200': jsonResponse(schema, description),
				'400': errorResponse(badRequestDescription),
				'503': errorResponse('The Hubble read model is unavailable.')
			}
		}
	};
}
export const hubbleAssetReportSchemas: Record<string, OpenApiRecord> = {
	HubbleAssetBalanceHistoryRow: {
		type: 'object',
		additionalProperties: false,
		properties: {
			ledger: sourceLedger,
			account_id: text,
			balance: sourceNumber,
			buying_liabilities: sourceNumber,
			selling_liabilities: sourceNumber,
			trust_line_limit: { ...sourceNumber, nullable: true },
			flags: { ...sourceLedger },
			sponsor: nullableText,
			last_modified_ledger: sourceLedger,
			deleted: { type: 'boolean' },
			source_row_number: sourceLedger,
			source_ingested_at: { type: 'string' },
			source_batch_id: sourceLedger,
			source_sha256: text,
			ledger_closed_at: { type: 'string', format: 'date-time' }
		}
	},
	HubbleAssetBalanceHistoryPage: {
		type: 'object',
		additionalProperties: false,
		properties: {
			asset: text,
			data: { type: 'array', items: ref('HubbleAssetBalanceHistoryRow') },
			limit: { type: 'integer', minimum: 1, maximum: 200 },
			nextCursor: nullableText,
			generatedAt: { type: 'string', format: 'date-time' },
			coverage: ref('HubbleLedgerCoverage'),
			coverageStatus: {
				type: 'string',
				enum: ['complete', 'partial_or_unknown']
			},
			amountPrecision: { type: 'string', enum: ['source-float64'] },
			semantics: text
		},
		required: [
			'asset',
			'data',
			'limit',
			'nextCursor',
			'generatedAt',
			'coverage',
			'coverageStatus',
			'amountPrecision',
			'semantics'
		]
	},
	HubbleAssetRankingRow: {
		type: 'object',
		additionalProperties: false,
		properties: {
			account_id: text,
			asset_volume: sourceNumber,
			counter_volume: { ...sourceNumber, nullable: true },
			trade_count: sourceLedger,
			operation_count: sourceLedger,
			transaction_count: {
				...sourceLedger,
				description:
					'Distinct trading transactions represented by matching trade observations; does not count every asset-transfer transaction.'
			},
			first_ledger: sourceLedger,
			last_ledger: sourceLedger,
			score: sourceNumber
		},
		required: [
			'account_id',
			'asset_volume',
			'counter_volume',
			'trade_count',
			'operation_count',
			'transaction_count',
			'first_ledger',
			'last_ledger',
			'score'
		]
	},
	HubbleAssetRankingPage: {
		type: 'object',
		additionalProperties: false,
		properties: {
			asset: text,
			data: { type: 'array', items: ref('HubbleAssetRankingRow') },
			limit: { type: 'integer', minimum: 1, maximum: 200 },
			nextCursor: nullableText,
			generatedAt: { type: 'string', format: 'date-time' },
			coverage: ref('HubbleLedgerCoverage'),
			coverageStatus: {
				type: 'string',
				enum: ['complete', 'partial_or_unknown']
			},
			amountPrecision: { type: 'string', enum: ['source-float64'] },
			marketTypes: {
				type: 'array',
				items: { type: 'string', enum: ['classic_orderbook', 'native_amm'] }
			},
			semantics: text
		},
		required: [
			'asset',
			'data',
			'limit',
			'nextCursor',
			'generatedAt',
			'coverage',
			'coverageStatus',
			'amountPrecision',
			'marketTypes',
			'semantics'
		]
	}
};
export const hubbleAssetReportPaths: Record<string, OpenApiRecord> = {
	'/v1/assets/{asset}/balances': op(
		'listAssetBalancesSnapshot',
		'List asset balance snapshot',
		'Returns latest-ingested holder-index observations including zero balances, with source Float64 precision, coverage, watermark, and indexed summary. No ledger window is required by default; this is not a pinned current-chain snapshot.',
		snapshotParameters,
		snapshotPage('asset_balances')
	),
	'/v1/assets/{asset}/trustlines': op(
		'listAssetTrustlinesSnapshot',
		'List asset trustline snapshot',
		'Returns latest-ingested issued-asset trustline observations including zero balances, with source Float64 precision, coverage, watermark, and indexed summary. Native asset trustlines are not defined and return HTTP 400.',
		snapshotParameters,
		snapshotPage('asset_trustlines'),
		'Invalid asset, filter, or cursor; native assets do not have trustlines.'
	),
	'/v1/analytics/assets/{asset}/balances': op(
		'listAnalyticsAssetBalancesSnapshot',
		'List asset balance snapshot',
		'Returns latest-ingested holder-index observations including zero balances, with source Float64 precision, coverage, watermark, and indexed summary. No ledger window is required by default; this is not a pinned current-chain snapshot.',
		snapshotParameters,
		snapshotPage('asset_balances')
	),
	'/v1/analytics/assets/{asset}/trustlines': op(
		'listAnalyticsAssetTrustlinesSnapshot',
		'List asset trustline snapshot',
		'Returns latest-ingested issued-asset trustline observations including zero balances, with source Float64 precision, coverage, watermark, and indexed summary. Native asset trustlines are not defined and return HTTP 400.',
		snapshotParameters,
		snapshotPage('asset_trustlines'),
		'Invalid asset, filter, or cursor; native assets do not have trustlines.'
	),
	'/v1/analytics/assets/{asset}/balance-history': op(
		'listAnalyticsAssetBalanceHistory',
		'List asset balance history',
		'Returns one final published state per account and ledger, including zero and deleted records, sponsor, flags, liabilities, and trustline limits. This is historical parsed-state data, not a complete current balance inventory; coverage gaps and source Float64 precision are explicit.',
		[
			...common,
			{
				in: 'query',
				name: 'account',
				required: false,
				description: 'Optional checksum-valid G or C address.',
				schema: { type: 'string', pattern: '^[GC][A-Z2-7]{55}$' }
			}
		],
		ref('HubbleAssetBalanceHistoryPage')
	),
	'/v1/analytics/assets/{asset}/rankings': op(
		'listAnalyticsAssetRankings',
		'Rank accounts by asset trade activity',
		'Normalizes seller/taker sides across classic orderbook and native AMM trade observations. transaction_count is distinct trading transactions represented by matching trade rows, not every transfer transaction. Does not cover Soroban contract pools. Amounts retain source Float64 precision; selection is not a complete current market view.',
		[
			...common,
			{
				in: 'query',
				name: 'metric',
				required: false,
				schema: {
					type: 'string',
					enum: ['bought', 'sold', 'volume', 'transactions'],
					default: 'volume'
				}
			},
			{
				in: 'query',
				name: 'counter_asset',
				required: false,
				description: 'Exact native or CODE:ISSUER counter asset.',
				schema: { type: 'string' }
			},
			{
				in: 'query',
				name: 'account',
				required: false,
				description: 'Optional checksum-valid G or C address.',
				schema: { type: 'string', pattern: '^[GC][A-Z2-7]{55}$' }
			}
		],
		ref('HubbleAssetRankingPage')
	)
};
