import type { ExplorerFilters } from '../../api/explorer-analytics';

const stateKeys = ['min_ledger', 'max_ledger', 'ledger_key_hash', 'durability', 'deleted', 'limit'] as const;
export interface StateRoute {
	readonly filters: ExplorerFilters;
	readonly identity: string;
	readonly position: string;
	readonly normalize: boolean;
}

function integer(value: string, minimum: number): boolean {
	return /^[0-9]+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= minimum;
}

/** State selection is independent of event filters and their opaque continuation. */
export function readStateRoute(contractId: string, initial: ExplorerFilters, params: URLSearchParams): StateRoute {
	const filters: Record<string, string> = {};
	for (const key of [...stateKeys, 'state_offset', 'state_for', 'offset']) {
		if (params.getAll(key).length > 1) throw new Error('Use one value for each state filter.');
	}
	for (const key of stateKeys) {
		const value = params.get(key) ?? (key === 'min_ledger' || key === 'max_ledger' ? initial[key] : undefined);
		if (value !== undefined && value !== null) filters[key] = value.trim();
	}
	for (const key of ['min_ledger', 'max_ledger'])
		if (filters[key] !== undefined && !integer(filters[key]!, 1)) throw new Error('Enter positive whole ledger numbers.');
	if (filters.min_ledger && filters.max_ledger && Number(filters.min_ledger) > Number(filters.max_ledger))
		throw new Error('The last ledger must be greater than or equal to the first ledger.');
	for (const key of ['ledger_key_hash', 'durability'])
		if (filters[key] !== undefined && !filters[key]) throw new Error('State filters cannot be empty.');
	if (filters.deleted !== undefined && !['true', 'false'].includes(filters.deleted)) throw new Error('Choose a valid deleted-state filter.');
	filters.limit ??= '25';
	if (!['10', '25', '50', '100'].includes(filters.limit)) throw new Error('Choose 10, 25, 50, or 100 changes per page.');
	const identity = JSON.stringify([contractId, ...stateKeys.map(key => filters[key] ?? '')]);
	const raw = params.get('state_offset') ?? params.get('offset') ?? '';
	if (raw && !integer(raw, 0)) throw new Error('Invalid contract state page.');
	if (params.has('state_offset') && !params.has('state_for')) throw new Error('The state page is missing its query. Start from the first page.');
	const changed = params.has('state_for') && params.get('state_for') !== identity;
	const position = changed || !raw || Number(raw) === 0 ? '' : String(Number(raw));
	return { filters, identity, position, normalize: changed || params.has('offset') || Boolean(position && !params.has('state_offset')) };
}

export function statePositionHref(pathname: string, search: string, route: StateRoute, position: string, hash = ''): string {
	if (position && !integer(position, 0)) throw new Error('Invalid contract state page.');
	const params = new URLSearchParams(search);
	params.delete('offset');
	params.delete('state_offset');
	params.delete('state_for');
	params.set('activity', 'state');
	if (position && Number(position) > 0) {
		params.set('state_offset', String(Number(position)));
		params.set('state_for', route.identity);
	}
	return pathname + (params.size ? '?' + params : '') + hash;
}

/** The parent contract lookup pins its window without dropping the selected state page. */
export function preserveContractActivityContext(href: string, search: string): string {
	const params = new URLSearchParams(search), url = new URL(href, 'https://example.invalid');
	for (const key of ['activity', 'ledger_key_hash', 'durability', 'deleted', 'state_offset', 'state_for', 'after', 'type_code', 'order', 'topic', 'q', 'transaction_hash', 'successful', 'in_successful_contract_call']) {
		url.searchParams.delete(key);
		for (const value of params.getAll(key)) url.searchParams.append(key, value);
	}
	return url.pathname + url.search + url.hash;
}

/** The parent identity lookup accepts a window, not the child activity's filters. */
export function contractIdentityFilters(filters: ExplorerFilters): ExplorerFilters {
	return Object.fromEntries(Object.entries(filters).filter(([key]) => ['min_ledger', 'max_ledger', 'start_time', 'end_time', 'limit'].includes(key)));
}
