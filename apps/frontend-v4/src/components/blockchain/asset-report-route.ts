export type AssetReportKind = 'rankings' | 'balance-history';
export type AssetReportQuery = Readonly<Record<string, string>>;
type Query = Pick<URLSearchParams, 'get' | 'getAll'>;
const fields = ['account', 'metric', 'counter_asset', 'start_time', 'end_time', 'min_ledger', 'max_ledger', 'order'] as const;
const prefix = (kind: AssetReportKind) => kind === 'rankings' ? 'rank_' : 'history_';
const names = (kind: AssetReportKind) => [...fields.map((field) => prefix(kind) + field), prefix(kind) + 'after', prefix(kind) + 'for'];
const address = /^[GC][A-Z2-7]{55}$/;
const asset = /^(native|[A-Za-z0-9]{1,12}:G[A-Z2-7]{55})$/;
export function validReportCursor(value: string): boolean {
	return /^[A-Za-z0-9_-]{1,2048}$/.test(value);
}
/** Validate shape locally; the API remains authoritative for address checksums. */
export function validateReportQuery(kind: AssetReportKind, input: AssetReportQuery): AssetReportQuery {
	const query: Record<string, string> = {};
	for (const field of fields) if (input[field]) query[field] = input[field]!;
	if (query.account && !address.test(query.account)) throw new Error('Enter a G or C account address.');
	if (kind === 'rankings') {
		query.metric ??= 'volume';
		if (!['volume', 'bought', 'sold', 'transactions'].includes(query.metric)) throw new Error('Choose a supported ranking metric.');
		if (query.counter_asset && !asset.test(query.counter_asset)) throw new Error('Counter asset must be native or CODE:ISSUER.');
	} else { delete query.metric; delete query.counter_asset; }
	query.order ??= 'desc';
	if (!['asc', 'desc'].includes(query.order)) throw new Error('Choose ascending or descending order.');
	for (const field of ['min_ledger', 'max_ledger'] as const) {
		const value = query[field];
		if (value && (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > 4294967295)) throw new Error('Invalid report ledger range.');
	}
	if (query.min_ledger && query.max_ledger && Number(query.min_ledger) > Number(query.max_ledger)) throw new Error('First ledger must not exceed last ledger.');
	for (const field of ['start_time', 'end_time'] as const) {
		const value = query[field];
		if (value && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)))) throw new Error('Enter a valid report date range.');
	}
	if (query.start_time && query.end_time && Date.parse(query.start_time) > Date.parse(query.end_time)) throw new Error('From must not be after To.');
	return query;
}
export function reportSelectionKey(asset: string, kind: AssetReportKind, query: AssetReportQuery): string {
	return JSON.stringify([asset, kind, Object.entries(query).sort(([a], [b]) => a.localeCompare(b))]);
}
export function readAssetReportRoute(params: Query, asset: string, kind: AssetReportKind): {query: AssetReportQuery; after: string; error: string | null} {
	try {
		if (names(kind).some((name) => params.getAll(name).length > 1)) throw new Error('Report URL contains repeated parameters.');
		const input = Object.fromEntries(fields.map((field) => [field, params.get(prefix(kind) + field) ?? '']));
		const query = validateReportQuery(kind, input);
		const after = params.get(prefix(kind) + 'after') ?? '';
		if (after && (!validReportCursor(after) || params.get(prefix(kind) + 'for') !== reportSelectionKey(asset, kind, query))) throw new Error('Report page does not match this asset and selection. Load the first page.');
		return {query, after, error: null};
	} catch (cause) { return {query: {}, after: '', error: cause instanceof Error ? cause.message : 'Invalid report URL.'}; }
}
export function assetReportHref(pathname: string, search: string, asset: string, kind: AssetReportKind, query: AssetReportQuery, after = '', fragment = ''): string {
	const params = new URLSearchParams(search);
	for (const name of names(kind)) params.delete(name);
	for (const [key, value] of Object.entries(validateReportQuery(kind, query))) params.set(prefix(kind) + key, value);
	if (after) {
		if (!validReportCursor(after)) throw new Error('Invalid report page.');
		params.set(prefix(kind) + 'after', after); params.set(prefix(kind) + 'for', reportSelectionKey(asset, kind, validateReportQuery(kind, query)));
	}
	return pathname + (params.size ? '?' + params.toString() : '') + fragment;
}
/** datetime-local is only the input shape; report controls explicitly use UTC. */
export function reportDateInput(value: string): string {
	if (!value) return '';
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 23) : '';
}
export function utcReportDate(value: string, original = ''): string {
	if (original && Number.isFinite(Date.parse(original)) && value === reportDateInput(original)) return original;
	if (!value) return '';
	if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/.test(value)) throw new Error('Enter a valid UTC report date.');
	const date = new Date(value + 'Z');
	if (!Number.isFinite(date.getTime())) throw new Error('Enter a valid report date.');
	return date.toISOString();
}
