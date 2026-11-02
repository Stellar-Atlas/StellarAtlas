import { sanitizeExplorerReturnTo } from '../../api/explorer-return-context';

export interface AssetMarketRoute {
	readonly view: 'trades' | 'liquidity-pools';
	readonly min: string;
	readonly max: string;
}

/** Continue one independently paginated side, not a fictitious combined cursor. */
export function assetTradeSideHref(asset: string, side: 'sell' | 'buy', window: { readonly minLedger: number; readonly maxLedger: number }, origin: string): string {
	const query = new URLSearchParams({
		[side === 'sell' ? 'selling_asset' : 'buying_asset']: asset,
		min_ledger: String(window.minLedger), max_ledger: String(window.maxLedger), limit: '25'
	});
	const returnTo = sanitizeExplorerReturnTo(origin);
	if (returnTo) query.set('return_to', returnTo);
	return '/explorer/trades?' + query;
}
type Query = Pick<URLSearchParams, 'get' | 'getAll'>;
const rangeKeys = ['market_trade_min', 'market_trade_max'] as const;

export function defaultAssetMarketRoute(maximum: number): AssetMarketRoute {
	const max = Number.isSafeInteger(maximum) && maximum >= 2 && maximum <= 4294967295 ? maximum : 2;
	return { view: 'trades', min: String(Math.max(2, max - 2047)), max: String(max) };
}

/** These are trade bounds, never a current-state selection for the pool index. */
export function readAssetMarketRoute(params: Query, maximum: number): AssetMarketRoute {
	const defaults = defaultAssetMarketRoute(maximum);
	const view = params.get('market_view');
	if ((view !== null && view !== 'trades' && view !== 'liquidity-pools') ||
		['market_view', ...rangeKeys].some(key => params.getAll(key).length > 1)) return defaults;
	const values = rangeKeys.map(key => params.get(key));
	const route = { ...defaults, view: view === 'liquidity-pools' ? 'liquidity-pools' as const : 'trades' as const };
	if (values.every(value => value === null)) return route;
	if (!values.every(value => value && /^[1-9]\d{0,9}$/.test(value))) return route;
	const min = Number(values[0]), max = Number(values[1]);
	if (min < 2 || max > 4294967295 || min > max || max - min > 2047) return route;
	return { ...route, min: String(min), max: String(max) };
}

export function assetMarketRouteHref(pathname: string, search: string, route: AssetMarketRoute, maximum: number, hash = ''): string {
	const params = new URLSearchParams(search);
	const defaults = defaultAssetMarketRoute(maximum);
	if (route.view === 'trades') params.delete('market_view');
	else params.set('market_view', route.view);
	if (route.min === defaults.min && route.max === defaults.max) rangeKeys.forEach(key => params.delete(key));
	else { params.set(rangeKeys[0], route.min); params.set(rangeKeys[1], route.max); }
	return pathname + (params.size ? '?' + params.toString() : '') + hash;
}
