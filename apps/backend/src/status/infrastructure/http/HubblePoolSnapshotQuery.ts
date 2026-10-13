import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError
} from './HubbleWarehouseErrors.js';
import { mapExplorerRecord } from './HubbleExplorerMapper.js';
import { normalizeNativePoolId } from './HubbleExplorerQuery.js';
import {
	quoteHubbleIdentifier,
	type HubblePreparedParameter,
	type HubbleSemanticQueryExecutor
} from './HubbleSemanticWarehouse.js';
import { parseAsset } from './HubbleSemanticRouteHelpers.js';

export type PoolOrderBy =
	| 'pool'
	| 'asset_a'
	| 'asset_b'
	| 'reserve_a'
	| 'reserve_b'
	| 'shares'
	| 'trustlines'
	| 'fee'
	| 'ledger'
	| 'time';
export interface SnapshotOptions {
	readonly id?: string;
	readonly limit: number;
	readonly after?: string;
	readonly orderBy: PoolOrderBy;
	readonly order: 'asc' | 'desc';
	readonly asset?: string;
	readonly assetA?: string;
	readonly assetB?: string;
	readonly deleted: boolean;
}
interface Cursor {
	readonly v: 1;
	readonly fingerprint: string;
	readonly value: string;
	readonly poolId: string;
}
interface RawPool extends Record<string, unknown> {
	readonly published: number | string;
	readonly pool_sort_value: string | number;
	readonly liquidity_pool_id: string;
}
interface PageCacheEntry {
	expiresAt: number;
	promise: Promise<Record<string, unknown>>;
}
const pageCache = new Map<string, PageCacheEntry>();
const cacheTtlMs = 30_000;
const cacheMaxPages = 32;

export async function queryHubblePoolSnapshot(
	warehouse: HubbleWarehouse,
	executor: HubbleSemanticQueryExecutor,
	options: SnapshotOptions
): Promise<Record<string, unknown>> {
	const catalog = await warehouse.catalog();
	const maximumLedger = Number(catalog.coverage.maximumLedger ?? 2);
	if (!Number.isSafeInteger(maximumLedger) || maximumLedger < 2)
		throw new HubbleWarehouseUnavailableError(
			'Invalid pool snapshot watermark'
		);
	const id =
		options.id === undefined ? undefined : normalizeNativePoolId(options.id);
	const fingerprint = fingerprintOptions({ ...options, id });
	const cursor =
		options.after === undefined
			? undefined
			: decodeCursor(options.after, fingerprint);
	const cacheKey = JSON.stringify([
		executor.database,
		fingerprint,
		cursor?.value ?? null,
		cursor?.poolId ?? null
	]);
	const cached = pageCache.get(cacheKey);
	if (cached && (cached.expiresAt === 0 || cached.expiresAt > Date.now()))
		return cached.promise;
	if (cached) pageCache.delete(cacheKey);
	const entry: PageCacheEntry = { expiresAt: 0, promise: Promise.resolve({}) };
	entry.promise = queryPage(
		executor,
		options,
		id,
		fingerprint,
		cursor,
		maximumLedger,
		catalog.coverage,
		catalog.generatedAt
	)
		.then((page) => {
			entry.expiresAt = Date.now() + cacheTtlMs;
			return page;
		})
		.catch((error) => {
			if (pageCache.get(cacheKey) === entry) pageCache.delete(cacheKey);
			throw error;
		});
	pageCache.set(cacheKey, entry);
	while (pageCache.size > cacheMaxPages)
		pageCache.delete(pageCache.keys().next().value!);
	return entry.promise;
}

async function queryPage(
	executor: HubbleSemanticQueryExecutor,
	options: SnapshotOptions,
	id: string | undefined,
	fingerprint: string,
	cursor: Cursor | undefined,
	maximumLedger: number,
	coverage: unknown,
	generatedAt: string
): Promise<Record<string, unknown>> {
	const database = quoteHubbleIdentifier(executor.database);
	const parameters: HubblePreparedParameter[] = [];
	const parameterCounts = new Map<string, number>();
	const bind = (name: string, type: string, value: string): string => {
		const count = (parameterCounts.get(name) ?? 0) + 1;
		parameterCounts.set(name, count);
		const uniqueName = count === 1 ? name : name + '_' + count;
		parameters.push({ name: uniqueName, type, value });
		return '{' + uniqueName + ':' + type + '}';
	};
	const filters: string[] = [];
	if (id !== undefined)
		filters.push('pool_id = ' + bind('poolId', 'String', id));
	if (options.deleted === false) filters.push('deleted = false');
	else filters.push('deleted = true');
	if (options.asset !== undefined) {
		const asset = parseAsset(options.asset);
		filters.push(
			'(' +
				assetPredicate(asset, 'a', bind) +
				' OR ' +
				assetPredicate(asset, 'b', bind) +
				')'
		);
	}
	if (options.assetA !== undefined)
		filters.push(assetPredicate(parseAsset(options.assetA), 'a', bind));
	if (options.assetB !== undefined)
		filters.push(assetPredicate(parseAsset(options.assetB), 'b', bind));
	const sort = sortExpression(options.orderBy);
	if (cursor !== undefined) {
		const comparison = options.order === 'asc' ? '>' : '<';
		const cursorValue = bind('cursorValue', sort.type, cursor.value);
		const cursorPool = bind('cursorPool', 'String', cursor.poolId);
		filters.push(
			'(pool_sort_value ' +
				comparison +
				' ' +
				cursorValue +
				' OR (pool_sort_value = ' +
				cursorValue +
				' AND pool_id ' +
				comparison +
				' ' +
				cursorPool +
				'))'
		);
	}
	const direction = options.order.toUpperCase();
	const count = id === undefined ? options.limit + 1 : 1;
	const sql = `WITH current AS (
	SELECT pool_id, max(state) AS state
	FROM ${database}._asset_pool_current
	GROUP BY pool_id
), decoded AS (
	SELECT pool_id,
		tupleElement(state, 1) AS _ledger_sequence,
		tupleElement(state, 2) AS _row_number,
		tupleElement(state, 4) AS _batch_id,
		tupleElement(state, 5) AS _source_sha256,
		tupleElement(state, 6) AS liquidity_pool_id_strkey,
		tupleElement(state, 7) AS type,
		tupleElement(state, 8) AS fee,
		toString(tupleElement(state, 9)) AS trustline_count,
		tupleElement(state, 10) AS pool_share_count,
		tupleElement(state, 11) AS asset_a_type,
		tupleElement(state, 12) AS asset_a_code,
		tupleElement(state, 13) AS asset_a_issuer,
		tupleElement(state, 14) AS asset_a_amount,
		tupleElement(state, 15) AS asset_b_type,
		tupleElement(state, 16) AS asset_b_code,
		tupleElement(state, 17) AS asset_b_issuer,
		tupleElement(state, 18) AS asset_b_amount,
		tupleElement(state, 19) AS deleted,
		tupleElement(state, 20) AS closed_at,
		tupleElement(state, 21) AS last_modified_ledger,
		tupleElement(state, 4) AS winning_batch_id,
		tupleElement(state, 5) AS winning_digest
	FROM current
), visible AS (
	SELECT *, (winning_batch_id, winning_digest) IN (
		SELECT batch_id, tupleElement(argMax(tuple(status, source_sha256), updated_at), 2)
		FROM ${database}._ingestion_batches
		GROUP BY batch_id
		HAVING tupleElement(argMax(tuple(status, source_sha256), updated_at), 1) = 'complete'
	) AS published,
		${sort.expression} AS pool_sort_value
	FROM decoded
)
SELECT pool_id AS liquidity_pool_id, _ledger_sequence, _row_number, _batch_id, _source_sha256,
	liquidity_pool_id_strkey, type, fee, trustline_count, pool_share_count,
	asset_a_type, asset_a_code, asset_a_issuer, asset_a_amount,
	asset_b_type, asset_b_code, asset_b_issuer, asset_b_amount,
	deleted, closed_at, last_modified_ledger, published, pool_sort_value
FROM visible
${filters.length ? 'WHERE ' + filters.join(' AND ') : ''}
ORDER BY pool_sort_value ${direction}, pool_id ${direction}
LIMIT ${count}
FORMAT JSON`;
	const response = await executor.execute<RawPool>(sql, parameters, 15_000);
	const rawRows = [...(response.data ?? [])];
	if (rawRows.some((row) => Number(row.published) !== 1))
		throw new HubbleWarehouseUnavailableError(
			'Pool snapshot winner is no longer published'
		);
	const hasMore = id === undefined && rawRows.length > options.limit;
	const selected = hasMore ? rawRows.slice(0, options.limit) : rawRows;
	const rows = selected.map((row) => mapExplorerRecord('liquidity-pools', row));
	const last = selected[selected.length - 1];
	const nextCursor =
		hasMore && last
			? encodeCursor({
					v: 1,
					fingerprint,
					value: String(last.pool_sort_value),
					poolId: last.liquidity_pool_id
				})
			: null;
	const base = {
		entity: 'liquidity-pools',
		window: { minLedger: 2, maxLedger: maximumLedger },
		coverage,
		coverageStatus: 'partial_or_unknown',
		source: 'stellar_hubble',
		freshness: 'latest-indexed',
		generatedAt,
		semantics:
			'Latest indexed native pool states at query time; pages are not snapshot-pinned.'
	};
	if (id !== undefined) return { ...base, record: rows[0] ?? null };
	return { ...base, rows, limit: options.limit, nextCursor };
}

function assetPredicate(
	asset: ReturnType<typeof parseAsset>,
	side: '' | 'a' | 'b',
	bind: (name: string, type: string, value: string) => string
): string {
	const prefix = side ? 'asset_' + side + '_' : 'asset_';
	if (asset.type === 'native') return prefix + "type = 'native'";
	return (
		'(' +
		prefix +
		"type IN ('credit_alphanum4','credit_alphanum12') AND " +
		prefix +
		'code = ' +
		bind('assetCode' + side + (side ? '' : '1'), 'String', asset.code) +
		' AND ' +
		prefix +
		'issuer = ' +
		bind('assetIssuer' + side + (side ? '' : '1'), 'String', asset.issuer) +
		')'
	);
}

function sortExpression(orderBy: PoolOrderBy): {
	expression: string;
	type: string;
} {
	const expressions: Record<PoolOrderBy, { expression: string; type: string }> =
		{
			pool: { expression: 'pool_id', type: 'String' },
			asset_a: {
				expression:
					"concat(asset_a_type, ':', asset_a_code, ':', asset_a_issuer)",
				type: 'String'
			},
			asset_b: {
				expression:
					"concat(asset_b_type, ':', asset_b_code, ':', asset_b_issuer)",
				type: 'String'
			},
			reserve_a: { expression: 'asset_a_amount', type: 'Float64' },
			reserve_b: { expression: 'asset_b_amount', type: 'Float64' },
			shares: { expression: 'pool_share_count', type: 'Float64' },
			trustlines: { expression: 'toUInt64(trustline_count)', type: 'UInt64' },
			fee: { expression: 'toUInt32(fee)', type: 'UInt32' },
			ledger: { expression: 'toUInt32(_ledger_sequence)', type: 'UInt32' },
			time: { expression: 'toUnixTimestamp64Micro(closed_at)', type: 'Int64' }
		};
	return expressions[orderBy];
}

function fingerprintOptions(
	options: SnapshotOptions & { readonly id?: string }
): string {
	return JSON.stringify([
		options.id ?? null,
		options.orderBy,
		options.order,
		options.asset ?? null,
		options.assetA ?? null,
		options.assetB ?? null,
		options.deleted,
		options.limit
	]);
}
function encodeCursor(cursor: Cursor): string {
	return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}
function decodeCursor(value: string, fingerprint: string): Cursor {
	if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value))
		throw new HubbleWarehouseInputError('Invalid after cursor');
	try {
		const cursor = JSON.parse(
			Buffer.from(value, 'base64url').toString('utf8')
		) as Partial<Cursor>;
		if (
			cursor.v !== 1 ||
			cursor.fingerprint !== fingerprint ||
			typeof cursor.value !== 'string' ||
			typeof cursor.poolId !== 'string' ||
			!/^[a-f0-9]{64}$/.test(cursor.poolId)
		)
			throw new Error();
		return cursor as Cursor;
	} catch {
		throw new HubbleWarehouseInputError('Invalid after cursor');
	}
}
