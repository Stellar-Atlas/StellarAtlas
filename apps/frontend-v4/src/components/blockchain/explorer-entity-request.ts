import {
	buildEntityApiPath,
	buildEntityHref,
	parseEntityPage,
	requestExplorerJson,
	type AnalyticsCollection,
	type AnalyticsEntityPage,
	type ExplorerFilters
} from '../../api/explorer-analytics';
import { normalizeExplorerTimes } from '../../api/explorer-search-route';

export interface ExplorerPageRequest {
	readonly filters: ExplorerFilters;
	readonly offset: number;
	readonly direction: 'reset' | 'next' | 'previous';
}
export type ExplorerPageOutcome =
	| {
			readonly ok: true;
			readonly page: AnalyticsEntityPage;
			readonly request: ExplorerPageRequest;
	  }
	| { readonly ok: false; readonly message: string };

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
		const timeout = setTimeout(() => abort.abort(), 25000);
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
			return {
				ok: false,
				message: abort.signal.aborted
					? 'The query timed out. Narrow the ledger range and try again.'
					: failure instanceof Error
						? failure.message
						: 'The data service could not complete this query.'
			};
		} finally {
			clearTimeout(timeout);
			if (generation === this.generation) this.active = null;
		}
	}
}

export function explorerPageHref(
	collection: AnalyticsCollection,
	identifier: string | undefined,
	filters: ExplorerFilters,
	offset: number
): string {
	return buildEntityHref(
		collection,
		identifier,
		identifier ? filters : { ...filters, offset: String(offset) }
	);
}

export function previousExplorerOffset(
	offset: number,
	limit: number,
	history: readonly number[]
): number {
	return history.at(-1) ?? Math.max(0, offset - limit);
}
