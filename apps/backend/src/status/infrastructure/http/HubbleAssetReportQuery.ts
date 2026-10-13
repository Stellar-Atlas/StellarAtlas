import type { HubbleLedgerCoverage } from './HubbleLedgerCoverage.js';
import {
	queryHubbleLedgerCoverage,
	isHubbleLedgerWindowComplete
} from './HubbleLedgerCoverage.js';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError
} from './HubbleWarehouseErrors.js';
import {
	buildAssetHistorySql,
	buildAssetRankSql,
	tradePerspectiveTuples
} from './HubbleAssetReportSql.js';
import {
	type HubbleAssetReference,
	type HubbleNativeAssetReference,
	type HubbleSemanticQueryExecutor
} from './HubbleSemanticWarehouse.js';

export type ReportAsset = HubbleAssetReference | HubbleNativeAssetReference;
export type ReportSelection = {
	asset: ReportAsset;
	minLedger?: number;
	maxLedger?: number;
	startTime?: string;
	endTime?: string;
	limit: number;
	after?: string;
	order: 'asc' | 'desc';
};
export type RankingSelection = ReportSelection & {
	metric: 'bought' | 'sold' | 'volume' | 'transactions';
	counterAsset?: ReportAsset;
	account?: string;
};
export type AssetReportPage = {
	asset: string;
	data: readonly Record<string, unknown>[];
	limit: number;
	nextCursor: string | null;
	generatedAt: string;
	coverage: HubbleLedgerCoverage;
	coverageStatus: 'complete' | 'partial_or_unknown';
	amountPrecision: 'source-float64';
	marketTypes?: readonly ['classic_orderbook', 'native_amm'];
	semantics?: string;
};
export type Cursor = {
	v: 1;
	kind: 'rank' | 'history';
	selection: string;
	max: number;
	min: number;
	score?: number;
	account?: string;
	ledger?: number;
};
const cache = new Map<
	string,
	{ expires: number; promise: Promise<readonly Record<string, unknown>[]> }
>();
const TTL = 300_000;
function assetKey(asset: ReportAsset): string {
	return asset.type === 'native' ? 'native' : asset.code + ':' + asset.issuer;
}
function encode(cursor: Cursor): string {
	return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}
function decode(
	value: string,
	kind: Cursor['kind'],
	selection: string
): Cursor {
	try {
		if (!/^[A-Za-z0-9_-]{1,2048}$/.test(value)) throw new Error();
		const c = JSON.parse(
			Buffer.from(value, 'base64url').toString('utf8')
		) as Cursor;
		if (
			c.v !== 1 ||
			c.kind !== kind ||
			c.selection !== selection ||
			!Number.isSafeInteger(c.max) ||
			!Number.isSafeInteger(c.min)
		)
			throw new Error();
		return c;
	} catch {
		throw new HubbleWarehouseInputError(
			'Invalid or mismatched asset report cursor'
		);
	}
}
function selectionKey(kind: string, input: object): string {
	return JSON.stringify([kind, input]);
}
function windowBounds(
	coverage: HubbleLedgerCoverage,
	input: ReportSelection,
	cursor?: Cursor
): { min: number; max: number } {
	const min =
		cursor?.min ?? input.minLedger ?? Number(coverage.minimumLedger ?? 2);
	const max =
		cursor?.max ?? input.maxLedger ?? Number(coverage.maximumLedger ?? 0);
	if (
		!Number.isSafeInteger(min) ||
		!Number.isSafeInteger(max) ||
		min < 1 ||
		max < min ||
		max > Number(coverage.maximumLedger ?? 0)
	)
		throw new HubbleWarehouseInputError(
			'Asset report ledger bounds exceed completed Hubble coverage'
		);
	return { min, max };
}
function pageCache(
	key: string,
	load: () => Promise<readonly Record<string, unknown>[]>
): Promise<readonly Record<string, unknown>[]> {
	const prior = cache.get(key);
	if (prior && prior.expires > Date.now()) return prior.promise;
	const promise = load();
	cache.set(key, { expires: Number.POSITIVE_INFINITY, promise });
	while (cache.size > 32) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined || oldest === key) break;
		cache.delete(oldest);
	}
	void promise.then(
		() => {
			const current = cache.get(key);
			if (current?.promise === promise) current.expires = Date.now() + TTL;
			while (cache.size > 32) cache.delete(cache.keys().next().value!);
		},
		() => {
			if (cache.get(key)?.promise === promise) cache.delete(key);
		}
	);
	return promise;
}
export { tradePerspectiveTuples };

export async function queryAssetRankings(
	executor: HubbleSemanticQueryExecutor,
	input: RankingSelection
): Promise<AssetReportPage> {
	const coverage = await queryHubbleLedgerCoverage(executor);
	const selection = selectionKey('rank', { ...input, after: undefined });
	const cursor = input.after
		? decode(input.after, 'rank', selection)
		: undefined;
	const { min, max } = windowBounds(coverage, input, cursor);
	if (cursor && (cursor.min !== min || cursor.max !== max))
		throw new HubbleWarehouseInputError('Mismatched ranking cursor');
	const cacheKey = JSON.stringify([
		executor.database,
		selection,
		min,
		max,
		cursor?.score ?? null,
		cursor?.account ?? null
	]);
	const started = performance.now();
	const rows = await pageCache(cacheKey, async () => {
		const query = buildAssetRankSql(
			executor.database,
			{ ...input, minLedger: min, maxLedger: max },
			cursor
		);
		const response = await executor.execute<Record<string, unknown>>(
			query.sql,
			query.parameters,
			300_000
		);
		if (!Array.isArray(response.data) || response.data.length > input.limit + 1)
			throw new HubbleWarehouseUnavailableError(
				'Incomplete or oversized asset ranking response'
			);
		return response.data;
	});
	const hasMore = rows.length > input.limit;
	const data = hasMore ? rows.slice(0, input.limit) : rows;
	const last = data.at(-1);
	const score = Number(last?.score);
	const nextCursor =
		hasMore && last && Number.isFinite(score)
			? encode({
					v: 1,
					kind: 'rank',
					selection,
					min,
					max,
					score,
					account: String(last.account_id ?? '')
				})
			: null;
	return {
		asset: assetKey(input.asset),
		data,
		limit: input.limit,
		nextCursor,
		generatedAt: new Date().toISOString(),
		coverage,
		coverageStatus: isHubbleLedgerWindowComplete(coverage, min, max)
			? 'complete'
			: 'partial_or_unknown',
		amountPrecision: 'source-float64',
		marketTypes: ['classic_orderbook', 'native_amm'],
		semantics:
			'Classic orderbook and native AMM trade observations; normalized account-side perspectives. Not Soroban pool coverage.'
	};
}
export async function queryAssetBalanceHistory(
	executor: HubbleSemanticQueryExecutor,
	input: ReportSelection,
	account?: string
): Promise<AssetReportPage> {
	const coverage = await queryHubbleLedgerCoverage(executor);
	const selection = selectionKey('history', {
		...input,
		after: undefined,
		account
	});
	const cursor = input.after
		? decode(input.after, 'history', selection)
		: undefined;
	const { min, max } = windowBounds(coverage, input, cursor);
	const key = JSON.stringify([
		executor.database,
		selection,
		min,
		max,
		cursor?.ledger ?? null,
		cursor?.account ?? null
	]);
	const started = performance.now();
	const rows = await pageCache(key, async () => {
		const query = buildAssetHistorySql(
			executor.database,
			{ ...input, minLedger: min, maxLedger: max },
			cursor,
			account
		);
		if (account)
			query.parameters.push({
				name: 'account',
				type: 'String',
				value: account
			});
		const response = await executor.execute<Record<string, unknown>>(
			query.sql,
			query.parameters,
			300_000
		);
		if (!Array.isArray(response.data) || response.data.length > input.limit + 1)
			throw new HubbleWarehouseUnavailableError(
				'Incomplete or oversized asset history response'
			);
		return response.data;
	});
	const hasMore = rows.length > input.limit,
		data = hasMore ? rows.slice(0, input.limit) : rows,
		last = data.at(-1);
	const nextCursor =
		hasMore && last
			? encode({
					v: 1,
					kind: 'history',
					selection,
					min,
					max,
					ledger: Number(last.ledger),
					account: String(last.account_id ?? '')
				})
			: null;
	return {
		asset: assetKey(input.asset),
		data,
		limit: input.limit,
		nextCursor,
		generatedAt: new Date().toISOString(),
		coverage,
		coverageStatus: isHubbleLedgerWindowComplete(coverage, min, max)
			? 'complete'
			: 'partial_or_unknown',
		amountPrecision: 'source-float64',
		semantics:
			'Historical per-ledger account state observations; not a statement of current complete balances.'
	};
}
export const reportQueryCache = cache;
