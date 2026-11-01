export type HolderSort = 'balance-desc' | 'balance-asc' | 'account-asc' | 'account-desc';
export interface HolderRoute {
	readonly sort: HolderSort;
	readonly includeZero: boolean;
	readonly after: string | null;
}
const sorts: readonly string[] = ['balance-desc', 'balance-asc', 'account-asc', 'account-desc'];
type Query = Pick<URLSearchParams, 'get' | 'getAll'>;

export function readHolderRoute(params: Query): HolderRoute {
	const sort = params.get('holder_sort');
	const zero = params.get('holder_zero');
	const after = params.get('holder_after');
	const validOptions = (sort === null || sorts.includes(sort)) &&
		(zero === null || zero === '1') &&
		['holder_sort', 'holder_zero', 'holder_after'].every(key => params.getAll(key).length <= 1);
	if (!validOptions) return { sort: 'balance-desc', includeZero: false, after: null };
	return {
		sort: sort && sorts.includes(sort) ? sort as HolderSort : 'balance-desc',
		includeZero: zero === '1',
		after: after && after.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(after) ? after : null
	};
}

/** Holder-specific keys never overwrite asset sections, event cursors or return links. */
export function holderRouteHref(pathname: string, search: string, route: HolderRoute, hash = ''): string {
	const params = new URLSearchParams(search);
	if (route.sort === 'balance-desc') params.delete('holder_sort');
	else params.set('holder_sort', route.sort);
	if (route.includeZero) params.set('holder_zero', '1');
	else params.delete('holder_zero');
	if (route.after) params.set('holder_after', route.after);
	else params.delete('holder_after');
	return pathname + (params.size ? '?' + params.toString() : '') + hash;
}
