import { recordValue, type ExplorerFilters } from '../../api/explorer-analytics';
import { parseAsset } from './asset-data';
import type { Asset } from './explorer-asset-types';

export interface AssetDiscoverySelection { readonly query: ExplorerFilters; readonly cursor: string | null }
export interface AssetDiscoveryPage { readonly data: readonly Asset[]; readonly next: string | null; readonly generatedAt: string | null; readonly catalogueReady: boolean }
type Query = Pick<URLSearchParams, 'get' | 'getAll' | 'keys'>;
const fields = ['q', 'symbol', 'issuer', 'min_ledger', 'max_ledger', 'start_time', 'end_time'] as const;
const serverKeys = new Set<string>(fields);
const pageKeys = new Set(['tab', 'return_to', 'view', 'limit']);
const pageOwned = (key: string): boolean => pageKeys.has(key) || ['holder_', 'rank_', 'history_', 'pool_', 'similar_', 'market_'].some(prefix => key.startsWith(prefix));
const cursorValid = (value: string): boolean => /^[A-Za-z0-9_-]{1,2048}$/.test(value);

/** Page-owned state never becomes an asset API filter. The API checks address checksums. */
export function validateAssetDiscoveryQuery(input: ExplorerFilters): ExplorerFilters {
	for (const key of Object.keys(input)) if (!serverKeys.has(key) && !pageOwned(key)) throw new Error('Unsupported asset search parameter: ' + key + '. Reapply the search.');
	const query: Record<string, string> = {};
	for (const key of fields) {
		const value = input[key]?.trim();
		if (!value) continue;
		if (value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid asset search value.');
		query[key] = value;
	}
	if (query.issuer && !/^G[A-Z2-7]{55}$/.test(query.issuer)) throw new Error('Enter a full issuer G-address.');
	for (const key of ['min_ledger', 'max_ledger'] as const) {
		const value = query[key];
		if (!value) continue;
		if (!/^\d{1,10}$/.test(value) || Number(value) < 1 || Number(value) > 4294967295) throw new Error('Enter a valid observed ledger range.');
		query[key] = String(Number(value));
	}
	if (query.min_ledger && query.max_ledger && Number(query.min_ledger) > Number(query.max_ledger)) throw new Error('From ledger must not exceed To ledger.');
	for (const key of ['start_time', 'end_time'] as const) {
		const value = query[key];
		if (!value) continue;
		const parts = /^(\d{4})-(\d\d)-(\d\d)T\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.exec(value);
		const date = new Date(value);
		if (!parts || !Number.isFinite(date.valueOf())) throw new Error('Enter a valid observation date.');
		const lastDay = new Date(0);
		lastDay.setUTCFullYear(Number(parts[1]), Number(parts[2]), 0);
		if (Number(parts[2]) < 1 || Number(parts[2]) > 12 || Number(parts[3]) < 1 || Number(parts[3]) > lastDay.getUTCDate()) throw new Error('Enter a valid observation date.');
		query[key] = date.toISOString();
	}
	if (query.start_time && query.end_time && query.start_time >= query.end_time) throw new Error('From time must precede To time.');
	return query;
}
export function assetDiscoveryDraft(params: Query, defaultQuery = ''): ExplorerFilters {
	return Object.fromEntries(fields.map(key => [key, params.get(key) ?? (key === 'q' ? defaultQuery : '')]));
}
export const assetDiscoveryQueryKey = (query: ExplorerFilters): string => JSON.stringify(fields.map(key => query[key] ?? ''));
export const assetDiscoveryKey = (selection: AssetDiscoverySelection): string => JSON.stringify([assetDiscoveryQueryKey(selection.query), selection.cursor]);
export function readAssetDiscoverySelection(params: Query, defaultQuery = ''): AssetDiscoverySelection {
	for (const key of params.keys()) if (!serverKeys.has(key) && !pageOwned(key) && key !== 'cursor' && key !== 'cursor_for') throw new Error('Unsupported asset search parameter: ' + key + '. Reapply the search.');
	if ([...fields, 'cursor', 'cursor_for'].some(key => params.getAll(key).length > 1)) throw new Error('Asset search parameters must not repeat.');
	const query = validateAssetDiscoveryQuery(assetDiscoveryDraft(params, defaultQuery)), cursor = params.get('cursor');
	if (cursor !== null ? !cursorValid(cursor) || params.get('cursor_for') !== assetDiscoveryQueryKey(query) : params.get('cursor_for') !== null) throw new Error('This page does not match the asset search. Return to the first page.');
	return { query, cursor };
}
export function assetDiscoveryHref(search: string, selection: AssetDiscoverySelection, hash = ''): string {
	// An explicit submission replaces old search fields, including rejected ones; it retains known page context only.
	const params = new URLSearchParams([...new URLSearchParams(search)].filter(([key]) => pageOwned(key) && key !== 'limit'));
	const query = validateAssetDiscoveryQuery(selection.query);
	for (const [key, value] of Object.entries(query)) params.set(key, value);
	if (selection.cursor !== null) {
		if (!cursorValid(selection.cursor)) throw new Error('Invalid asset continuation.');
		params.set('cursor', selection.cursor); params.set('cursor_for', assetDiscoveryQueryKey(query));
	}
	return '/explorer/assets' + (params.size ? '?' + params : '') + hash;
}
export function assetDiscoveryPath(selection: AssetDiscoverySelection): string {
	const params = new URLSearchParams({ ...validateAssetDiscoveryQuery(selection.query), limit: '25' });
	if (selection.cursor !== null) {
		if (!cursorValid(selection.cursor)) throw new Error('Invalid asset continuation.');
		params.set('cursor', selection.cursor);
	}
	return '/v1/assets?' + params;
}
export function parseAssetDiscoveryPage(value: unknown, cursor: string | null): AssetDiscoveryPage {
	const row = recordValue(value), coverage = recordValue(row.coverage);
	if (!Array.isArray(row.data) || row.data.length > 25 || typeof coverage.catalogueReady !== 'boolean' ||
		!(row.generatedAt === null || typeof row.generatedAt === 'string' && Number.isFinite(Date.parse(row.generatedAt))) ||
		!(row.nextCursor === null || typeof row.nextCursor === 'string' && cursorValid(row.nextCursor) && row.nextCursor !== cursor)) throw new Error('Invalid asset catalogue page.');
	const data = row.data.map(parseAsset), identities = new Set(data.map(asset => asset.id));
	if (identities.size !== data.length) throw new Error('Duplicate asset identities returned.');
	return { data, next: row.nextCursor as string | null, generatedAt: row.generatedAt as string | null, catalogueReady: coverage.catalogueReady };
}
