import type { ExplorerFilters } from '../../api/explorer-analytics';
import type { PoolSort } from './explorer-pool-table';

export interface PoolBrowserRoute {
	readonly filters: ExplorerFilters;
	readonly sort: PoolSort;
	readonly order: 'asc' | 'desc';
	readonly limit: string;
	readonly historical: boolean;
	readonly position: string;
}
type Query = Pick<URLSearchParams, 'get' | 'getAll'>;
const sorts: readonly string[] = ['pool', 'asset_a', 'asset_b', 'reserve_a', 'reserve_b', 'shares', 'trustlines', 'fee', 'ledger', 'time'];
const filterKeys = ['asset', 'asset_a', 'asset_b', 'pool_id', 'deleted', 'min_ledger', 'max_ledger', 'start_time', 'end_time'] as const;
const controls = ['pool_sort', 'pool_order', 'pool_rows', 'pool_mode', 'pool_after', 'pool_offset', 'pool_for', 'pool_filters'] as const;

function cleanFilters(value: Record<string, unknown>): ExplorerFilters {
	return Object.fromEntries(filterKeys.flatMap((key) => typeof value[key] === 'string' && value[key].trim() && value[key].length <= 512 && !/[\u0000-\u001f\u007f]/.test(value[key]) ? [[key, value[key]]] : []));
}
function orderedFilters(filters: ExplorerFilters): string[][] {
	return Object.entries(filters).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}
export function poolRouteKey(route: PoolBrowserRoute, position = true): string {
	return JSON.stringify([orderedFilters(route.filters), route.sort, route.order, route.limit, route.historical, position ? route.position : '']);
}
export function validPoolPosition(value: string | null, historical: boolean): value is string {
	return !!value && (historical ? /^(0|[1-9]\d{0,4})$/.test(value) && Number(value) <= 10000 : value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value));
}

export function readPoolBrowserRoute(params: Query, initial: ExplorerFilters, initialOffset: number, embedded: boolean, asset?: string): PoolBrowserRoute {
	let filters = cleanFilters(initial);
	if (!embedded && (filterKeys.some((key) => params.get(key) !== null) || params.get('pool_mode') !== null))
		filters = cleanFilters(Object.fromEntries(filterKeys.map((key) => [key, params.getAll(key).length <= 1 ? params.get(key) : null])));
	if (embedded && params.get('pool_filters') !== null) {
		filters = {};
		const encoded = params.get('pool_filters') ?? '';
		if (encoded.length <= 4096) try {
			const value: unknown = JSON.parse(encoded);
			if (value && typeof value === 'object' && !Array.isArray(value)) filters = cleanFilters(value as Record<string, unknown>);
		} catch { /* Invalid selection falls back to an unfiltered bounded page. */ }
	}
	if (asset) filters = { ...filters, asset };
	const mode = params.get('pool_mode');
	const oldOffset = (!embedded ? params.get('offset') : null) ?? (mode === 'latest' ? '0' : String(initialOffset));
	const historical = !!(filters.min_ledger || filters.max_ledger || filters.start_time || filters.end_time || mode === 'history' || (validPoolPosition(oldOffset, true) && oldOffset !== '0'));
	const defaults: PoolBrowserRoute = { filters, sort: 'trustlines', order: 'desc', limit: '25', historical, position: '' };
	if (controls.some((key) => params.getAll(key).length > 1)) return defaults;
	const sort = params.get('pool_sort') ?? (!embedded ? params.get('order_by') : null) ?? 'trustlines';
	const order = params.get('pool_order') ?? (!embedded ? params.get('order') : null) ?? 'desc';
	const limit = params.get('pool_rows') ?? (!embedded ? params.get('limit') : null) ?? '25';
	if (!sorts.includes(sort) || !['asc', 'desc'].includes(order) || !['10', '25', '50', '100'].includes(limit) || (mode !== null && !['latest', 'history'].includes(mode))) return defaults;
	const route: PoolBrowserRoute = { ...defaults, sort: sort as PoolSort, order: order as 'asc' | 'desc', limit };
	if (historical) {
		const offset = params.get('pool_offset') ?? oldOffset;
		return { ...route, position: validPoolPosition(offset, true) && offset !== '0' ? offset : '' };
	}
	const after = params.get('pool_after');
	return { ...route, position: validPoolPosition(after, false) && params.get('pool_for') === poolRouteKey(route, false) ? after : '' };
}

export function poolBrowserHref(pathname: string, search: string, route: PoolBrowserRoute, embedded: boolean, fragment = ''): string {
	const params = new URLSearchParams(search);
	for (const key of controls) params.delete(key);
	params.set('pool_sort', route.sort);
	params.set('pool_order', route.order);
	params.set('pool_rows', route.limit);
	params.set('pool_mode', route.historical ? 'history' : 'latest');
	if (embedded) params.set('pool_filters', JSON.stringify(cleanFilters(route.filters)));
	else {
		for (const key of [...filterKeys, 'offset', 'order_by', 'order', 'limit']) params.delete(key);
		for (const [key, value] of Object.entries(cleanFilters(route.filters))) params.set(key, value);
	}
	if (validPoolPosition(route.position, route.historical)) {
		if (route.historical) params.set('pool_offset', route.position);
		else { params.set('pool_after', route.position); params.set('pool_for', poolRouteKey(route, false)); }
	}
	return pathname + (params.size ? '?' + params.toString() : '') + fragment;
}
