import { buildEntityHref } from '../../api/explorer-analytics';
import { sanitizeExplorerReturnTo } from '../../api/explorer-return-context';
import { normalizeExplorerTimes } from '../../api/explorer-search-route';
import { transferPageSize, type TransferFilters } from '../../api/transfer-activity';
import { normalizeTransactionHash } from '../../domain/transaction-hash';

export const transferFields = [
	['event_topic', 'Event topic (transfer, mint, burn, clawback or fee)', 'text'],
	['account', 'Account (sender or recipient)', 'text'],
	['asset', 'Asset (native or CODE:ISSUER)', 'text'],
	['from', 'Sender', 'text'],
	['to', 'Recipient', 'text'],
	['min_ledger', 'First ledger (included)', 'text'],
	['max_ledger', 'Last ledger (included)', 'text'],
	['start_time', 'From time (your timezone, included)', 'datetime-local'],
	['end_time', 'Until time (your timezone, excluded)', 'datetime-local'],
	['min_amount_raw', 'Minimum raw integer amount', 'text'],
	['max_amount_raw', 'Maximum raw integer amount', 'text'],
	['transaction_hash', 'Transaction hash', 'text'],
	['contract_id', 'Token contract ID', 'text']
] as const;

const runKey = 'transfer_query', pageKey = 'transfer_after', windowKey = 'transfer_window', boundKey = 'transfer_bound';
const ledger = (value: number): boolean =>
	Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
export const validTransferCursor = (value: string): boolean => /^[A-Za-z0-9_-]{1,2048}$/.test(value);
export type TransferWindow = readonly [number, number];
export type TransferSelection = {
	filters: TransferFilters;
	after: string | null;
	window?: TransferWindow;
	/** Cursor was issued to explicit pinned bounds, not the original unbounded filters. */
	boundWindow?: boolean;
};
export const validTransferWindow = ([min, max]: TransferWindow): boolean =>
	ledger(min) && ledger(max) && min <= max && max - min < 1_000_000;

export function readTransferSelection(params: URLSearchParams): {
	filters: TransferFilters; selection: TransferSelection | null; error: string | null;
} {
	const size = transferPageSize(params.get('limit') ?? undefined);
	const filters: TransferFilters = { limit: String(size ?? 25) };
	const active = params.has(runKey), after = params.get(pageKey), raw = params.get(windowKey);
	const tuple = raw === null ? null : /^(\d+):(\d+)$/.exec(raw);
	const window: TransferWindow | undefined =
		tuple ? [Number(tuple[1]), Number(tuple[2])] : undefined;
	const invalid = () => ({ filters, selection: null, error: 'Invalid transfer link. Review the filters and select Find transfers to start again.' });
	for (const [name] of transferFields) {
		const values = params.getAll(name);
		const value = values[0];
		if (values.length === 1 && value !== undefined && value.length <= 512) filters[name] = value;
	}
	const validTime = (value: string | undefined): boolean =>
		!value || (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
			Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
	if ([...transferFields.map(([name]) => name), 'limit', runKey, pageKey, windowKey, boundKey, 'after'].some(key => params.getAll(key).length > 1) ||
		size === null || (params.has(boundKey) && (params.get(boundKey) !== '1' || !window)) ||
		transferFields.some(([name]) => (params.get(name)?.length ?? 0) > 512) ||
		params.has('after') ||
		(active && params.get(runKey) !== '1') ||
		(active && (!validTime(filters.start_time) || !validTime(filters.end_time))) ||
		(!active && (after !== null || raw !== null)) ||
		(after !== null && !validTransferCursor(after)) ||
		(raw !== null && (!window || !validTransferWindow(window) || raw !== window.join(':') ||
			(!!filters.min_ledger && window[0] !== Number(filters.min_ledger)) ||
			(!!filters.max_ledger && !(window[1] <= Number(filters.max_ledger)))))) return invalid();
	return { filters, selection: active ? { filters, after, window, boundWindow: params.has(boundKey) } : null, error: null };
}

export function transferSelectionHref(path: string, search: string, selection: TransferSelection): string {
	const params = new URLSearchParams(search);
	params.delete('after');
	params.delete(pageKey);
	params.delete(windowKey);
	params.delete(boundKey);
	params.set(runKey, '1');
	const filters = normalizeExplorerTimes(selection.filters);
	const size = transferPageSize(filters.limit);
	if (size === null) throw new Error('Select 25, 50 or 100 transfers per page.');
	params.set('limit', String(size));
	for (const [name] of transferFields) {
		params.delete(name);
		const value = filters[name]?.trim();
		if (value) params.set(name, value);
	}
	if (selection.after !== null) params.set(pageKey, selection.after);
	if (selection.window) params.set(windowKey, selection.window.join(':'));
	if (selection.boundWindow && selection.window) params.set(boundKey, '1');
	if (readTransferSelection(params).error) throw new Error('Invalid transfer filters or continuation.');
	const href = path + '?' + params.toString();
	if (sanitizeExplorerReturnTo(href) === null) throw new Error('The transfer link is too long or invalid.');
	return href;
}

export function transferRequestFilters(selection: TransferSelection): TransferFilters {
	const window = selection.window;
	// The first cursor can be bound to implicit API defaults; do not change that fingerprint mid-page.
	return window && (selection.after === null || selection.boundWindow)
		? { ...selection.filters, min_ledger: String(window[0]), max_ledger: String(window[1]) } : selection.filters;
}

export function transferTransactionReference(hash: string | null | undefined, sequence: number) {
	const normalized = normalizeTransactionHash(hash ?? '');
	if (!normalized) return { label: hash?.trim() ? 'Invalid transaction hash' : 'Not recorded', href: null };
	return {
		label: normalized,
		href: buildEntityHref('transactions', normalized, ledger(sequence) ? { ledger_sequence: String(sequence) } : {})
	};
}
