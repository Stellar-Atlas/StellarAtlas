import type { OpenApiRecord } from './OpenApiDocumentProjection.js';
import { jsonResponse, ref } from './HubbleOpenApiSchemas.js';
import { errorResponse } from './HubbleSemanticOpenApiParameters.js';

const seconds = { type: 'integer', minimum: 0, maximum: 4294967295 };
const amount = {
	type: 'string',
	description:
		'Quote units per base unit for prices; asset units for volumes. Source Float64 precision.'
};
const asset = {
	type: 'string',
	example: 'native',
	description:
		'native or exact CODE:ISSUER. Resolve SAC addresses through /v1/assets/{asset} first. Symbol-only identifiers are ambiguous.'
};
const ledger = { type: 'integer', minimum: 2, maximum: 4294967295 };
export const marketCandleSchemas: Record<string, OpenApiRecord> = {
	MarketCandle: {
		type: 'object',
		additionalProperties: false,
		required: [
			'timestamp',
			'open',
			'high',
			'low',
			'close',
			'baseVolume',
			'quoteVolume',
			'tradeCount',
			'firstTradeAt',
			'lastTradeAt'
		],
		properties: {
			timestamp: {
				...seconds,
				description:
					'UTC Unix seconds at the epoch-aligned start of the time bin.'
			},
			open: amount,
			high: amount,
			low: amount,
			close: amount,
			baseVolume: amount,
			quoteVolume: amount,
			tradeCount: { type: 'integer', minimum: 1 },
			firstTradeAt: seconds,
			lastTradeAt: seconds
		}
	},
	MarketCandlePage: {
		type: 'object',
		additionalProperties: false,
		required: [
			'base',
			'quote',
			'resolution',
			'from',
			'to',
			'candles',
			'source',
			'venues',
			'precision',
			'generatedAt',
			'asOf',
			'coverage'
		],
		properties: {
			base: asset,
			quote: asset,
			resolution: { type: 'integer', enum: [60, 300, 900, 3600, 14400, 86400] },
			from: seconds,
			to: seconds,
			candles: { type: 'array', maxItems: 200, items: ref('MarketCandle') },
			source: { type: 'string', enum: ['history_trades'] },
			venues: {
				type: 'array',
				items: { type: 'string', enum: ['classic-dex', 'native-amm'] }
			},
			precision: { type: 'string', enum: ['source_float64'] },
			generatedAt: { type: 'string', format: 'date-time' },
			asOf: {
				...seconds,
				nullable: true,
				description:
					'Last included trade time; null when there are no trades. This is independent of response generation time.'
			},
			coverage: {
				type: 'object',
				additionalProperties: false,
				required: [
					'minLedger',
					'maxLedger',
					'firstSourceTime',
					'lastSourceTime',
					'ledgerRangeComplete',
					'timeRangeComplete',
					'status',
					'emptyBuckets'
				],
				properties: {
					minLedger: ledger,
					maxLedger: ledger,
					firstSourceTime: { ...seconds, nullable: true },
					lastSourceTime: { ...seconds, nullable: true },
					ledgerRangeComplete: { type: 'boolean' },
					timeRangeComplete: { type: 'boolean' },
					status: { type: 'string', enum: ['complete', 'partial'] },
					emptyBuckets: { type: 'string', enum: ['omitted'] }
				}
			}
		}
	}
};
export const marketCandlePaths: Record<string, OpenApiRecord> = {
	'/v1/markets/{base}/{quote}/candles': {
		get: {
			operationId: 'getMarketCandles',
			summary: 'Pair trade candles',
			tags: ['Markets'],
			security: [],
			description:
				'OHLC and volumes from published classic DEX and native AMM trades in both directions. Open/close use ledger, operation and trade order after logical deduplication. Prices are in the exact quote asset; USDC is not automatically USD. Soroban swap events are not included. Returns ascending UTC bins with no fabricated empty candles. Time bounds are inclusive from and exclusive to. Defaults to up to 200 bins ending at the latest published source time within the latest 65536 ledgers. Supply both ledger bounds for older history, spanning at most 65536 ledgers. Coverage reports incomplete ingestion or time bounds outside the selected source window. Use adjacent, non-overlapping time windows for pagination; there is no offset. This bounded history slice is not a full-history rollup or a live-price guarantee.',
			parameters: [
				{ in: 'path', name: 'base', required: true, schema: asset },
				{ in: 'path', name: 'quote', required: true, schema: asset },
				{
					in: 'query',
					name: 'from',
					schema: seconds,
					description: 'Inclusive Unix seconds. Supply with to.'
				},
				{
					in: 'query',
					name: 'to',
					schema: seconds,
					description: 'Exclusive Unix seconds. Supply with from.'
				},
				{
					in: 'query',
					name: 'resolution',
					schema: {
						type: 'integer',
						enum: [60, 300, 900, 3600, 14400, 86400],
						default: 300
					}
				},
				{
					in: 'query',
					name: 'limit',
					schema: { type: 'integer', minimum: 1, maximum: 200, default: 200 },
					description:
						'Maximum time bins in the requested window. Oversized windows are rejected, never silently truncated.'
				},
				{ in: 'query', name: 'min_ledger', schema: ledger },
				{ in: 'query', name: 'max_ledger', schema: ledger }
			],
			responses: {
				'200': jsonResponse(
					ref('MarketCandlePage'),
					'Bounded candles and publication coverage.'
				),
				'400': errorResponse(
					'Invalid or oversized asset/time/ledger selection.'
				),
				'503': errorResponse(
					'Market query unavailable or read capacity exceeded; no partial aggregates are returned.'
				)
			}
		}
	}
};
