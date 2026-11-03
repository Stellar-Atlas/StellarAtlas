import type { ExplorerFilters } from '../../api/explorer-analytics';
import type { ContractActivityTab } from '../../api/explorer-contract-activity';
import { applyEventControls, createEventControls, type EventControls } from './contract-event-controls';

const selectionKeys = ['type_code', 'order', 'limit', 'topic', 'q', 'after'] as const;

/** URL-owned event fields must not fall back to props from an older navigation. */
export function readEventRouteInput(filters: ExplorerFilters, search: URLSearchParams): ExplorerFilters {
	const next = { ...filters };
	for (const key of selectionKeys) {
		delete next[key];
		const value = search.get(key);
		if (value !== null) next[key] = value;
	}
	return next;
}

export function readEventRoute(filters: ExplorerFilters, search: URLSearchParams): ExplorerFilters {
	const next = readEventRouteInput(filters, search);
	const applied = applyEventControls(next, createEventControls(next));
	if (next.after) applied.after = next.after;
	return applied;
}

/** Commit only applied controls; unrelated detail, outcome and return state survives. */
export function eventControlsHref(pathname: string, search: string, controls: EventControls, hash = ''): string {
	const params = new URLSearchParams(search);
	for (const key of [...selectionKeys, 'offset']) params.delete(key);
	for (const [key, value] of Object.entries(applyEventControls({}, controls))) params.set(key, value);
	return pathname + (params.size ? '?' + params : '') + hash;
}

export function eventPositionHref(pathname: string, search: string, position: string, hash = ''): string {
	const params = new URLSearchParams(search);
	if (position) params.set('after', position);
	else params.delete('after');
	return pathname + (params.size ? '?' + params : '') + hash;
}

/** Query identity, not parameter order or an unrelated return link, gates late responses. */
export function contractActivityUrlIdentity(search: string, tab: ContractActivityTab): string {
	const params = new URLSearchParams(search);
	const fixed = ['contract_id', 'min_ledger', 'max_ledger', ...(tab === 'events'
		? ['transaction_hash', 'start_time', 'end_time', 'successful', 'in_successful_contract_call']
		: ['ledger_key_hash', 'durability', 'deleted'])];
	return JSON.stringify([
		params.get('activity') === 'state' ? 'state' : 'events',
		fixed.map(key => params.getAll(key)),
		tab === 'events' ? readEventRoute({}, params) : null
	]);
}
