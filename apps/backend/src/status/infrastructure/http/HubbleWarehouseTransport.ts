import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';
import { currentHubbleRequestSignal } from './HubbleRequestCancellation.js';
import { readHubbleWarehouseJson } from './HubbleWarehouseJsonResponse.js';
import type {
	HubblePreparedParameter,
	HubblePreparedResponse
} from './HubbleSemanticWarehouse.js';

export function createHubbleWarehouseTransport(
	endpoint: URL,
	fetchImplementation: typeof fetch,
	authorization: string | undefined
) {
	return async function execute<T>(
		sql: string,
		parameters: readonly HubblePreparedParameter[],
		timeoutMs = 100_000,
		queryId?: string
	): Promise<HubblePreparedResponse<T>> {
		const url = new URL(endpoint);
		if (queryId !== undefined) {
			url.searchParams.set('query_id', queryId);
			// No settings override for the readonly role, and never request
			// replacement through an inherited endpoint query parameter.
			url.searchParams.delete('replace_running_query');
		}
		url.searchParams.set('query', sql);
		for (const parameter of parameters) {
			url.searchParams.set('param_' + parameter.name, parameter.value);
		}
		const headers: Record<string, string> = { Accept: 'application/json' };
		if (authorization !== undefined) headers.Authorization = authorization;
		const deadline = AbortSignal.timeout(timeoutMs);
		const caller = currentHubbleRequestSignal();
		const signal = caller === undefined ? deadline : AbortSignal.any([deadline, caller]);
		let response: Response;
		try {
			signal.throwIfAborted();
			response = await fetchImplementation(url, {
				headers,
				method: 'POST',
				signal
			});
		} catch {
			// Transport errors may retain endpoint URLs or credentials in their causes.
			throw new HubbleWarehouseUnavailableError(
				signal.aborted ? 'ClickHouse request canceled' : 'ClickHouse request failed'
			);
		}
		return readHubbleWarehouseJson<T>(response, signal);
	};
}
