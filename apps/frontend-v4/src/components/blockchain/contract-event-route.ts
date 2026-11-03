import type { ExplorerFilters } from '../../api/explorer-analytics';
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
