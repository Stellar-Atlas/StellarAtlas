import {
	buildEntityApiPath,
	buildEntityHref,
	ExplorerHttpError,
	parseEntityPage,
	recordValue,
	requestExplorerJson,
	type AnalyticsCollection,
	type AnalyticsEntityPage,
	type ExplorerFilters
} from '../../api/explorer-analytics';
import { explorerRouteFilters, explorerRouteOffset, normalizeExplorerTimes } from '../../api/explorer-search-route';
import { sanitizeExplorerReturnTo } from '../../api/explorer-return-context';

export interface ExplorerPageRequest {
	readonly filters: ExplorerFilters;
	readonly offset: number;
	readonly direction: 'reset' | 'next' | 'previous';
}
export function readExplorerPageSelection(search: string | null, initialFilters: ExplorerFilters, initialOffset: number, detail: boolean): { filters: ExplorerFilters; offset: number } {
	if (search === null) return { filters: initialFilters, offset: detail ? 0 : initialOffset };
	const params = new URLSearchParams(search);
	const values: Record<string, string | string[]> = {};
	for (const key of new Set(params.keys())) {
		const entries = params.getAll(key);
		values[key] = entries.length === 1 ? entries[0]! : entries;
	}
	return { filters: explorerRouteFilters(values), offset: detail ? 0 : explorerRouteOffset(values.offset) ?? 0 };
}
export function explorerSelectionKey(filters: ExplorerFilters, offset: number): string {
	return JSON.stringify([Object.entries(filters).filter(([, value]) => value.trim()).sort(([a], [b]) => a.localeCompare(b)), offset]);
}
export type ExplorerPageOutcome =
	| {
			readonly ok: true;
			readonly page: AnalyticsEntityPage;
			readonly request: ExplorerPageRequest;
	  }
	| { readonly ok: false; readonly message: string; readonly windowMiss?: ContractActivityWindowMiss };

export interface ContractActivityWindowMiss {
	readonly coverage: 'complete' | 'partial_or_unknown';
	readonly minLedger: number;
	readonly maxLedger: number;
}

function contractActivityWindowMiss(failure: unknown): ContractActivityWindowMiss | undefined {
	if (!(failure instanceof ExplorerHttpError)) return;
	const { details, status } = failure;
	if (details.source !== 'stellar_hubble' || details.entity !== 'contracts' || details.record !== null) return;
	const coverage = details.coverageStatus;
	if (!(
		(status === 404 && details.code === 'hubble_record_not_found' && coverage === 'complete') ||
		(status === 409 && details.code === 'hubble_range_not_fully_ingested' && coverage === 'partial_or_unknown')
	)) return;
	const { minLedger, maxLedger } = recordValue(details.window);
	if (typeof minLedger !== 'number' || typeof maxLedger !== 'number' ||
		!Number.isSafeInteger(minLedger) || !Number.isSafeInteger(maxLedger) ||
		minLedger < 1 || maxLedger < minLedger || maxLedger > 0xffffffff) return;
	return { coverage, minLedger, maxLedger };
}

/** Own only one bounded request; a failed request remains the exact retry target. */
export class ExplorerEntityRequest {
	private active: AbortController | null = null;
	private generation = 0;
	private attempt: ExplorerPageRequest | null = null;
	constructor(
		private readonly collection: AnalyticsCollection,
		private readonly identifier?: string,
		private readonly fetchJson = requestExplorerJson
	) {}
	get retryRequest(): ExplorerPageRequest | null {
		return this.attempt;
	}
	cancel(): void {
		this.generation++;
		this.active?.abort();
		this.active = null;
	}
	async run(request: ExplorerPageRequest): Promise<ExplorerPageOutcome | null> {
		this.cancel();
		const generation = this.generation;
		const abort = new AbortController();
		this.active = abort;
		this.attempt = { ...request, filters: { ...request.filters } };
		try {
			const filters = normalizeExplorerTimes(this.attempt.filters);
			const page = parseEntityPage(
				await this.fetchJson(
					buildEntityApiPath(
						this.collection,
						this.identifier,
						filters,
						request.offset
					),
					abort.signal
				)
			);
			if (generation !== this.generation) return null;
			return { ok: true, page, request: { ...request, filters } };
		} catch (failure) {
			if (generation !== this.generation) return null;
			const windowMiss = this.collection === 'contracts' && this.identifier && !abort.signal.aborted
				? contractActivityWindowMiss(failure) : undefined;
			return {
				ok: false,
				...(windowMiss ? { windowMiss } : {}),
				message: abort.signal.aborted
					? 'The query was cancelled. Retry or narrow the ledger range.'
					: failure instanceof Error
						? failure.message
						: 'The data service could not complete this query.'
			};
		} finally {
			if (generation === this.generation) this.active = null;
		}
	}
}

export function explorerPageHref(
	collection: AnalyticsCollection,
	identifier: string | undefined,
	filters: ExplorerFilters,
	offset: number,
	returnTo?: string | null
): string {
	const href = buildEntityHref(
		collection,
		identifier,
		identifier ? filters : { ...filters, offset: String(offset) }
	);
	const origin = sanitizeExplorerReturnTo(returnTo);
	if (identifier || !origin) return href;
	const url = new URL(href, 'https://explorer.invalid');
	url.searchParams.set('return_to', origin);
	return url.pathname + url.search;
}

export function previousExplorerOffset(
	offset: number,
	limit: number,
	history: readonly number[]
): number {
	return history.at(-1) ?? Math.max(0, offset - limit);
}
