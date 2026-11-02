import type { HubbleWarehouse } from '../HubbleWarehouseContracts.js';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError
} from '../HubbleWarehouseErrors.js';
import { isHubbleLedgerWindowComplete } from '../HubbleLedgerCoverage.js';
import type {
	HubblePreparedParameter,
	HubbleSemanticQueryExecutor
} from '../HubbleSemanticWarehouse.js';
import {
	marketCandleSql,
	marketSourceWindowSql,
	marketReadEstimateSql
} from './MarketCandleSql.js';
import {
	marketMaximumLedgerSpan,
	type MarketCandle,
	type MarketCandleInput,
	type MarketCandlePage
} from './MarketCandleContracts.js';
import { validateCandleTimeRange } from './MarketCandleValidation.js';

interface SourceWindow {
	readonly first_time: number | string | null;
	readonly last_time: number | string | null;
	readonly first_ledger: number | string;
	readonly last_ledger: number | string;
	readonly from_ledger: number | string;
	readonly to_ledger: number | string;
}
type RawCandle = { readonly [K in keyof MarketCandle]: string | number };
const numberFields = [
	'timestamp',
	'tradeCount',
	'firstTradeAt',
	'lastTradeAt'
] as const;
const amountFields = [
	'open',
	'high',
	'low',
	'close',
	'baseVolume',
	'quoteVolume'
] as const;

export async function queryMarketCandles(
	warehouse: HubbleWarehouse,
	executor: HubbleSemanticQueryExecutor,
	input: MarketCandleInput
): Promise<MarketCandlePage> {
	const catalog = await warehouse.catalog();
	const publishedMaximum = Number(catalog.coverage.maximumLedger ?? 0);
	if (!Number.isSafeInteger(publishedMaximum) || publishedMaximum < 2)
		throw new HubbleWarehouseUnavailableError(
			'Published trade history is unavailable'
		);
	const maxLedger = input.maxLedger ?? publishedMaximum;
	const minLedger =
		input.minLedger ?? Math.max(2, maxLedger - marketMaximumLedgerSpan + 1);
	const parameters: HubblePreparedParameter[] = [
		bind('minLedger', 'UInt32', minLedger),
		bind('maxLedger', 'UInt32', maxLedger),
		bind('from', 'UInt32', input.from ?? 0),
		bind('to', 'UInt32', input.to ?? 4_294_967_295)
	];
	await checkReadEstimate(executor, 'history_ledgers', minLedger, maxLedger);
	let source = (
		await executor.execute<SourceWindow>(
			marketSourceWindowSql(executor.database),
			parameters,
			12_000
		)
	).data?.[0];
	if (!source)
		throw new HubbleWarehouseUnavailableError('Source time bounds unavailable');
	const firstSourceTime = nullableInteger(source.first_time);
	const lastSourceTime = nullableInteger(source.last_time);
	// Defaults end at the latest published observation. generatedAt is never used as data time.
	const to =
		input.to ??
		(lastSourceTime === null
			? 0
			: Math.min(
					4_294_967_295,
					(Math.floor(lastSourceTime / input.resolution) + 1) * input.resolution
				));
	const from = input.from ?? Math.max(0, to - input.resolution * input.limit);
	if (to > 0) validateCandleTimeRange(from, to, input.resolution, input.limit);
	if (input.from === undefined && to > 0) {
		// Resolve the default time window to a narrow ledger interval before reading trades.
		source = (
			await executor.execute<SourceWindow>(
				marketSourceWindowSql(executor.database),
				[
					bind('minLedger', 'UInt32', minLedger),
					bind('maxLedger', 'UInt32', maxLedger),
					bind('from', 'UInt32', from),
					bind('to', 'UInt32', to)
				],
				12_000
			)
		).data?.[0];
		if (!source)
			throw new HubbleWarehouseUnavailableError(
				'Source time bounds unavailable'
			);
	}
	const narrowedMinimum = Number(source.from_ledger);
	const narrowedMaximum = Number(source.to_ledger);
	const selectedMinimum =
		narrowedMinimum >= minLedger ? narrowedMinimum : minLedger;
	const selectedMaximum =
		narrowedMaximum >= selectedMinimum && narrowedMaximum <= maxLedger
			? narrowedMaximum
			: maxLedger;
	const ledgerRangeComplete = isHubbleLedgerWindowComplete(
		catalog.coverage,
		selectedMinimum,
		selectedMaximum
	);
	const timeRangeComplete =
		firstSourceTime !== null &&
		lastSourceTime !== null &&
		firstSourceTime <= from &&
		lastSourceTime >= to;
	let candles: readonly MarketCandle[] = [];
	if (
		firstSourceTime !== null &&
		lastSourceTime !== null &&
		to > firstSourceTime &&
		from <= lastSourceTime
	) {
		// Time filters narrow the already bounded, primary-key-indexed ledger interval.
		if (
			narrowedMinimum >= minLedger &&
			narrowedMaximum <= maxLedger &&
			narrowedMinimum <= narrowedMaximum
		) {
			await checkReadEstimate(
				executor,
				'history_trades',
				narrowedMinimum,
				narrowedMaximum
			);
			const response = await executor.execute<RawCandle>(
				marketCandleSql(executor.database),
				[
					bind('minLedger', 'UInt32', narrowedMinimum),
					bind('maxLedger', 'UInt32', narrowedMaximum),
					bind('base', 'String', input.base),
					bind('quote', 'String', input.quote),
					bind('from', 'UInt32', from),
					bind('to', 'UInt32', to),
					bind('resolution', 'UInt32', input.resolution),
					bind('limit', 'UInt32', input.limit + 1)
				],
				17_000
			);
			candles = (response.data ?? []).map(parseCandle);
			if (candles.length > input.limit)
				throw new HubbleWarehouseUnavailableError(
					'Candle response exceeded the requested time-bin bound'
				);
		}
	}
	return {
		base: input.base,
		quote: input.quote,
		resolution: input.resolution,
		from,
		to,
		candles,
		source: 'history_trades',
		venues: ['classic-dex', 'native-amm'],
		precision: 'source_float64',
		generatedAt: new Date().toISOString(),
		asOf: candles.at(-1)?.lastTradeAt ?? null,
		coverage: {
			minLedger: selectedMinimum,
			maxLedger: selectedMaximum,
			firstSourceTime,
			lastSourceTime,
			ledgerRangeComplete,
			timeRangeComplete,
			status: ledgerRangeComplete && timeRangeComplete ? 'complete' : 'partial',
			emptyBuckets: 'omitted'
		}
	};
}

async function checkReadEstimate(
	executor: HubbleSemanticQueryExecutor,
	table: 'history_ledgers' | 'history_trades',
	minLedger: number,
	maxLedger: number
): Promise<void> {
	const response = await executor.execute<{
		table: string;
		rows: number | string;
	}>(
		marketReadEstimateSql(executor.database, table),
		[
			bind('minLedger', 'UInt32', minLedger),
			bind('maxLedger', 'UInt32', maxLedger)
		],
		3_000
	);
	const estimates = response.data?.filter((row) => row.table === table);
	if (!estimates?.length)
		throw new HubbleWarehouseUnavailableError(
			'Market read estimate unavailable'
		);
	const rows = estimates.reduce((sum, row) => sum + Number(row.rows), 0);
	if (!Number.isSafeInteger(rows) || rows < 0)
		throw new HubbleWarehouseUnavailableError('Invalid market read estimate');
	if (rows > 2_000_000)
		throw new HubbleWarehouseInputError(
			'Candle window exceeds the direct-read budget; shorten the time or ledger range'
		);
}

function bind(
	name: string,
	type: string,
	value: string | number
): HubblePreparedParameter {
	return { name, type, value: String(value) };
}
function nullableInteger(value: number | string | null): number | null {
	if (value === null) return null;
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0)
		throw new HubbleWarehouseUnavailableError('Invalid source timestamp');
	return number;
}
function parseCandle(row: RawCandle): MarketCandle {
	const result: Record<string, number | string> = {};
	for (const name of numberFields) {
		const value = Number(row[name]);
		if (!Number.isSafeInteger(value) || value < 0)
			throw new HubbleWarehouseUnavailableError('Invalid candle ' + name);
		result[name] = value;
	}
	for (const name of amountFields) {
		const value = row[name];
		if (
			(typeof value !== 'string' && typeof value !== 'number') ||
			!Number.isFinite(Number(value)) ||
			Number(value) <= 0
		)
			throw new HubbleWarehouseUnavailableError('Invalid candle ' + name);
		result[name] = String(value);
	}
	return result as unknown as MarketCandle;
}
