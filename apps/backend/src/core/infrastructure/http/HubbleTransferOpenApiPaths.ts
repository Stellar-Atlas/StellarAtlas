import type { OpenApiRecord } from './OpenApiDocumentProjection.js';

const nullableString: OpenApiRecord = { type: 'string', nullable: true };
const transferSchema: OpenApiRecord = {
	type: 'object',
	additionalProperties: false,
	required: [
		'id',
		'ledgerSequence',
		'closedAt',
		'transactionHash',
		'transactionId',
		'operationId',
		'from',
		'to',
		'toMuxed',
		'asset',
		'contractId',
		'eventTopic',
		'amountRaw',
		'amountScale'
	],
	properties: {
		id: { type: 'string' },
		ledgerSequence: { type: 'integer' },
		closedAt: { type: 'string', format: 'date-time' },
		transactionHash: { type: 'string' },
		transactionId: { type: 'string' },
		operationId: nullableString,
		from: nullableString,
		to: nullableString,
		toMuxed: nullableString,
		contractId: { type: 'string' },
		eventTopic: { type: 'string' },
		amountRaw: {
			type: 'string',
			pattern: '^-?[0-9]+$',
			description:
				'Exact observed signed i128 atomic units; never a floating-point amount or a guarantee of valid standard token execution.'
		},
		amountScale: {
			type: 'integer',
			nullable: true,
			description:
				'7 for classic/native assets; null when a contract scale is not known.'
		},
		asset: {
			type: 'object',
			additionalProperties: false,
			required: ['id', 'type', 'code', 'issuer'],
			properties: {
				id: { type: 'string' },
				type: { type: 'string' },
				code: nullableString,
				issuer: nullableString
			}
		}
	}
};
const pageSchema: OpenApiRecord = {
	type: 'object',
	additionalProperties: false,
	required: [
		'transfers',
		'limit',
		'nextCursor',
		'watermark',
		'elapsedMilliseconds'
	],
	properties: {
		transfers: { type: 'array', items: transferSchema },
		limit: { type: 'integer', minimum: 1, maximum: 200 },
		nextCursor: nullableString,
		elapsedMilliseconds: { type: 'number' },
		watermark: {
			type: 'object',
			additionalProperties: false,
			required: ['minimumLedger', 'maximumLedger', 'observedAt', 'coverage'],
			properties: {
				minimumLedger: { type: 'integer' },
				maximumLedger: { type: 'integer' },
				observedAt: { type: 'string', format: 'date-time' },
				coverage: { type: 'string', enum: ['ingested-only'] }
			}
		}
	}
};
function query(
	name: string,
	description: string,
	schema: OpenApiRecord = { type: 'string' }
): OpenApiRecord {
	return { in: 'query', name, description, required: false, schema };
}
const parameters: readonly OpenApiRecord[] = [
	query(
		'account',
		'Either sender, recipient, or muxed recipient. Directional filters are combined with AND.'
	),
	query('from', 'Exact sender G, C, or M address.'),
	query('to', 'Exact recipient G, C, or M address.'),
	query(
		'asset',
		'native or CODE:ISSUER; contract tokens can instead use contract_id.',
		{ type: 'string', example: 'native' }
	),
	query('contract_id', 'Exact token contract C-address.'),
	query('transaction_hash', '64-character hexadecimal transaction hash.'),
	query(
		'event_topic',
		'Source event category. Select transfer for transfer events; omitted includes fees, mints, burns, and clawbacks.',
		{
			type: 'string',
			enum: ['transfer', 'mint', 'burn', 'clawback', 'fee'],
			example: 'transfer'
		}
	),
	query(
		'start_time',
		'Inclusive UTC ISO timestamp ending in Z; additionally narrows the stated ledger range.',
		{ type: 'string', format: 'date-time' }
	),
	query('end_time', 'Exclusive UTC ISO timestamp ending in Z.', {
		type: 'string',
		format: 'date-time'
	}),
	query(
		'min_ledger',
		'Inclusive minimum ledger. Use explicit bounds for historical date searches.',
		{ type: 'integer', minimum: 1, example: 26000000 }
	),
	query(
		'max_ledger',
		'Inclusive maximum ledger, capped to published ingestion watermark. At most 1000000 ledgers per query.',
		{ type: 'integer', minimum: 1, example: 26000099 }
	),
	query(
		'amount_raw',
		'Exact atomic units, canonical non-negative Int128 integer string; no exponent, fraction, or Float64 conversion.'
	),
	query(
		'min_amount_raw',
		'Inclusive exact minimum atomic units (integer string).'
	),
	query(
		'max_amount_raw',
		'Inclusive exact maximum atomic units (integer string).'
	),
	query(
		'limit',
		'Requested rows; fetches one extra row to determine nextCursor. Excess limits are rejected.',
		{ type: 'integer', minimum: 1, maximum: 200, default: 100, example: 10 }
	),
	query(
		'after',
		'Opaque nextCursor from the previous page. Keep all filters unchanged.'
	)
];
const description =
	'Typed, lossless token-transfer activity from completed matching-source batches. ' +
	'When bounds are omitted, searches the latest 100000 published ledgers; dates narrow that ledger window, not all history. ' +
	'Responses state the effective ledger window. Maximum requested span is 1000000 ledgers. ' +
	'Keyset cursors preserve total ordering and the initial ledger watermark, but are NOT frozen database snapshots: ' +
	'backfills, retries, and republication can change visibility. Ingested-only is not a claim of gap-free history. ' +
	'Queries use the server-managed read-only profile for time, memory, and result budgets; exhaustion fails instead of returning partial success. ' +
	'eventTopic is the source event category, not an inferred payment classification.';

function operation(
	operationId: string,
	summary: string,
	scope?: 'account' | 'asset'
): OpenApiRecord {
	const scoped =
		scope === undefined
			? []
			: [
					{
						in: 'path',
						name: scope,
						required: true,
						description:
							scope === 'asset'
								? 'native or URL-encoded CODE:ISSUER.'
								: 'Stellar G, C, or M address.',
						schema: {
							type: 'string',
							...(scope === 'asset' ? { example: 'native' } : {})
						}
					}
				];
	return {
		get: {
			operationId,
			summary,
			description,
			tags: ['Analytics'],
			security: [],
			parameters: [
				...scoped,
				...parameters.filter((parameter) => parameter.name !== scope)
			],
			responses: {
				'200': {
					description:
						'Typed transfer page; atomic amounts and IDs are strings.',
					content: { 'application/json': { schema: pageSchema } }
				},
				'400': {
					description:
						'Invalid or conflicting filters, cursor, or oversized range.'
				},
				'503': {
					description:
						'Warehouse unavailable or bounded query budget exceeded; narrow the range or retry.'
				}
			}
		}
	};
}
export const hubbleTransferPaths: Readonly<Record<string, OpenApiRecord>> = {
	'/v1/analytics/activity/transfers': operation(
		'searchAnalyticsTransferActivity',
		'Search exact token-transfer activity'
	),
	'/v1/analytics/accounts/{account}/activity/transfers': operation(
		'listAnalyticsAccountTransferActivity',
		'List account transfer activity',
		'account'
	),
	'/v1/analytics/assets/{asset}/activity/transfers': operation(
		'listAnalyticsAssetTransferActivity',
		'List asset transfer activity',
		'asset'
	)
};
