import type { EntityRecord, ExplorerFilters } from '../../api/explorer-analytics';

const keys = ['min_ledger', 'max_ledger', 'start_time', 'end_time', 'deleted'] as const;
const windowLedger = (value: unknown): number => typeof value === 'number' ? value
	: typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : NaN;

export function poolContextQuery(context: ExplorerFilters): URLSearchParams {
	return new URLSearchParams(keys.flatMap(key => {
		const value = context[key];
		return typeof value === 'string' && value.trim() ? [[key, value]] : [];
	}));
}

export function hasPoolHistory(context: ExplorerFilters): boolean {
	return keys.slice(0, 4).some(key => Boolean(context[key]));
}

/** Use the accepted displayed request, not a newer failed selection. */
export function poolContextFromRequest(path: string, window?: EntityRecord): ExplorerFilters {
	const params = new URL(path, 'https://explorer.invalid').searchParams;
	const context = Object.fromEntries(poolContextQuery(Object.fromEntries(params)));
	if (!hasPoolHistory(context) && window) {
		const min = windowLedger(window.minLedger), max = windowLedger(window.maxLedger);
		if ([min, max].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 4294967295) && min <= max) {
			context.min_ledger = String(min);
			context.max_ledger = String(max);
		}
	}
	return context;
}

export function poolDetailHref(id: string, context: ExplorerFilters = {}): string {
	const query = poolContextQuery(context);
	return '/explorer/liquidity-pools/' + encodeURIComponent(id) + (query.size ? '?' + query : '');
}

export function poolListHref(context: ExplorerFilters): string {
	const query = poolContextQuery(context);
	return '/explorer/liquidity-pools' + (query.size ? '?' + query : '');
}
