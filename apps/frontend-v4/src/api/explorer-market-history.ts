import { recordValue } from './explorer-analytics';
import { validatePairReportSelection, type PairReportSelection } from './explorer-pair-report';

const resolution = 300;
const limit = 200;
const maxUInt32 = 4_294_967_295;

export interface MarketHistoryBin {
	readonly timestamp: number;
	readonly close: string;
	readonly baseVolume: string;
	readonly quoteVolume: string;
	readonly tradeCount: number;
	readonly lastTradeAt: number;
}

export interface MarketHistory {
	readonly from: number;
	readonly to: number;
	readonly resolution: number;
	readonly bins: readonly MarketHistoryBin[];
	readonly asOf: number | null;
	readonly hasPublishedSource: boolean;
	readonly ledgerRangeComplete: boolean;
	readonly timeRangeComplete: boolean;
}

function pinnedPair(selection: PairReportSelection) {
	const pair = validatePairReportSelection(selection);
	if (!pair.minLedger || !pair.maxLedger || Number(pair.maxLedger) > maxUInt32)
		throw new Error('Price history needs a valid, selected ledger range.');
	return { ...pair, minLedger: pair.minLedger, maxLedger: pair.maxLedger };
}

export function marketHistoryPath(selection: PairReportSelection): string {
	const pair = pinnedPair(selection);
	const query = new URLSearchParams({
		min_ledger: pair.minLedger,
		max_ledger: pair.maxLedger,
		resolution: String(resolution),
		limit: String(limit)
	});
	return '/v1/markets/' + encodeURIComponent(pair.assetA) + '/' +
		encodeURIComponent(pair.assetB) + '/candles?' + query;
}

function invalid(): never {
	throw new Error('Invalid price and volume response.');
}
function integer(value: unknown, min = 0, max = maxUInt32): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
		return invalid();
	return value;
}
function nullableTimestamp(value: unknown): number | null {
	return value === null ? null : integer(value);
}
function amount(value: unknown): string {
	if (typeof value !== 'string' || !/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value) ||
		!Number.isFinite(Number(value)) || Number(value) <= 0) return invalid();
	return value;
}

export function parseMarketHistory(value: unknown, selection: PairReportSelection): MarketHistory {
	const pair = pinnedPair(selection);
	const response = recordValue(value), coverage = recordValue(response.coverage);
	const from = integer(response.from), to = integer(response.to);
	const asOf = nullableTimestamp(response.asOf);
	const firstSource = nullableTimestamp(coverage.firstSourceTime), lastSource = nullableTimestamp(coverage.lastSourceTime);
	const minLedger = integer(coverage.minLedger, Number(pair.minLedger), Number(pair.maxLedger));
	integer(coverage.maxLedger, minLedger, Number(pair.maxLedger));
	if (response.base !== pair.assetA || response.quote !== pair.assetB || response.resolution !== resolution ||
		response.source !== 'history_trades' || response.precision !== 'source_float64' ||
		!Array.isArray(response.venues) || response.venues.length !== 2 ||
		!response.venues.includes('classic-dex') || !response.venues.includes('native-amm') ||
		!Array.isArray(response.candles) || response.candles.length > limit ||
		typeof coverage.ledgerRangeComplete !== 'boolean' || typeof coverage.timeRangeComplete !== 'boolean' ||
		coverage.status !== (coverage.ledgerRangeComplete && coverage.timeRangeComplete ? 'complete' : 'partial') ||
		coverage.emptyBuckets !== 'omitted' || from > to || to - from > resolution * limit ||
		(firstSource === null) !== (lastSource === null) ||
		(firstSource !== null && lastSource !== null && firstSource > lastSource))
		return invalid();

	let previous = -1;
	const bins = response.candles.map((entry: unknown): MarketHistoryBin => {
		const row = recordValue(entry);
		const timestamp = integer(row.timestamp), lastTradeAt = integer(row.lastTradeAt);
		if (timestamp % resolution || timestamp <= previous || timestamp >= to || timestamp + resolution <= from ||
			lastTradeAt < Math.max(timestamp, from) || lastTradeAt >= Math.min(timestamp + resolution, to) ||
			firstSource === null || lastSource === null || lastTradeAt < firstSource || lastTradeAt > lastSource)
			return invalid();
		previous = timestamp;
		return {
			timestamp, lastTradeAt, close: amount(row.close),
			baseVolume: amount(row.baseVolume), quoteVolume: amount(row.quoteVolume),
			tradeCount: integer(row.tradeCount, 1, Number.MAX_SAFE_INTEGER)
		};
	});
	if (asOf !== (bins.at(-1)?.lastTradeAt ?? null)) return invalid();
	return {
		from, to, resolution, bins, asOf, hasPublishedSource: firstSource !== null,
		ledgerRangeComplete: coverage.ledgerRangeComplete, timeRangeComplete: coverage.timeRangeComplete
	};
}
