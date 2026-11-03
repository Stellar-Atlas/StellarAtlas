import { buildEntityHref } from '../../api/explorer-analytics';
import { sanitizeExplorerReturnTo } from '../../api/explorer-return-context';
import { normalizeExplorerTimes } from '../../api/explorer-search-route';
import type { TransferFilters } from '../../api/transfer-activity';
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

const runKey = 'transfer_query', pageKey = 'transfer_after', windowKey = 'transfer_window';
const ledger = (value: number): boolean =>
	Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
export const validTransferCursor = (value: string): boolean => /^[A-Za-z0-9_-]{1,2048}$/.test(value);
export type TransferWindow = readonly [number, number];
export type TransferSelection = {
	filters: TransferFilters;
	after: string | null;
	window?: TransferWindow;
};
export const validTransferWindow = ([min, max]: TransferWindow): boolean =>
	ledger(min) && ledger(max) && min <= max && max - min < 1_000_000;

export function readTransferSelection(params: URLSearchParams): {
	filters: TransferFilters; selection: TransferSelection | null; error: string | null;
} {
	const filters: TransferFilters = {};
	const active = params.has(runKey), after = params.get(pageKey), raw = params.get(windowKey);
	const tuple = raw?.split(':').map(Number);
	const window: TransferWindow | undefined =
		tuple?.length === 2 ? [tuple[0], tuple[1]] : undefined;
	const invalid = () => ({ filters, selection: null, error: 'Invalid transfer link. Review the filters and select Find transfers to start again.' });
	for (const [name] of transferFields) {
		const values = params.getAll(name);
		if (values.length === 1 && values[0].length <= 512) filters[name] = values[0];
	}
	const validTime = (value: string | undefined): boolean =>
		!value || (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
			Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
	if ([...transferFields.map(([name]) => name), runKey, pageKey, windowKey, 'after'].some(key => params.getAll(key).length > 1) ||
		transferFields.some(([name]) => (params.get(name)?.length ?? 0) > 512) ||
		params.has('after') ||
		(active && params.get(runKey) !== '1') ||
		(active && (!validTime(filters.start_time) || !validTime(filters.end_time))) ||
		(!active && (after !== null || raw !== null)) ||
		(after !== null && !validTransferCursor(after)) ||
		(raw !== null && (!window || !validTransferWindow(window) || raw !== window.join(':') ||
			(!!filters.min_ledger && window[0] !== Number(filters.min_ledger)) ||
			(!!filters.max_ledger && !(window[1] <= Number(filters.max_ledger)))))) return invalid();
	return { filters, selection: active ? { filters, after, window } : null, error: null };
}

export function transferSelectionHref(path: string, search: string, selection: TransferSelection): string {
	const params = new URLSearchParams(search);
	params.delete('after');
	params.delete(pageKey);
	params.delete(windowKey);
	params.set(runKey, '1');
	const filters = normalizeExplorerTimes(selection.filters);
	for (const [name] of transferFields) {
		params.delete(name);
		const value = filters[name]?.trim();
		if (value) params.set(name, value);
	}
	if (selection.after !== null) params.set(pageKey, selection.after);
	if (selection.window) params.set(windowKey, selection.window.join(':'));
	if (readTransferSelection(params).error) throw new Error('Invalid transfer filters or continuation.');
	const href = path + '?' + params.toString();
	if (sanitizeExplorerReturnTo(href) === null) throw new Error('The transfer link is too long or invalid.');
	return href;
}

export function transferRequestFilters(selection: TransferSelection): TransferFilters {
	const window = selection.window;
	return window ? { ...selection.filters, min_ledger: String(window[0]), max_ledger: String(window[1]) } : selection.filters;
}

export function transferTransactionReference(hash: string | null | undefined, sequence: number) {
	const normalized = normalizeTransactionHash(hash ?? '');
	if (!normalized) return { label: hash?.trim() ? 'Invalid transaction hash' : 'Not recorded', href: null };
	return {
		label: normalized,
		href: buildEntityHref('transactions', normalized, ledger(sequence) ? { ledger_sequence: String(sequence) } : {})
	};
}
