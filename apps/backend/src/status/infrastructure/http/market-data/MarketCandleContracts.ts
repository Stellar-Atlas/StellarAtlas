export interface MarketCandleInput {
	readonly base: string;
	readonly quote: string;
	readonly resolution: number;
	readonly limit: number;
	readonly from?: number;
	readonly to?: number;
	readonly minLedger?: number;
	readonly maxLedger?: number;
}

export interface MarketCandle {
	/** UTC Unix seconds; epoch-aligned, inclusive bucket start. */
	readonly timestamp: number;
	readonly open: string;
	readonly high: string;
	readonly low: string;
	readonly close: string;
	readonly baseVolume: string;
	readonly quoteVolume: string;
	readonly tradeCount: number;
	readonly firstTradeAt: number;
	readonly lastTradeAt: number;
}

export interface MarketCandlePage {
	readonly base: string;
	readonly quote: string;
	readonly resolution: number;
	readonly from: number;
	readonly to: number;
	readonly candles: readonly MarketCandle[];
	readonly source: 'history_trades';
	readonly venues: readonly ['classic-dex', 'native-amm'];
	readonly precision: 'source_float64';
	readonly generatedAt: string;
	readonly asOf: number | null;
	readonly coverage: {
		readonly minLedger: number;
		readonly maxLedger: number;
		readonly firstSourceTime: number | null;
		readonly lastSourceTime: number | null;
		readonly ledgerRangeComplete: boolean;
		readonly timeRangeComplete: boolean;
		readonly status: 'complete' | 'partial';
		readonly emptyBuckets: 'omitted';
	};
}

export const marketCandleResolutions = [
	60, 300, 900, 3600, 14400, 86400
] as const;
export const marketMaximumLedgerSpan = 65_536;
