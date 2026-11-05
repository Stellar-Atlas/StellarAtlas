import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';
import { currentHubbleRequestSignal } from './HubbleRequestCancellation.js';
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
		try {
			const deadline = AbortSignal.timeout(timeoutMs);
			const caller = currentHubbleRequestSignal();
			const response = await fetchImplementation(url, {
				headers,
				method: 'POST',
				signal:
					caller === undefined ? deadline : AbortSignal.any([deadline, caller])
			});
			const body = await response.text();
			if (!response.ok) {
				throw new HubbleWarehouseUnavailableError(
					'ClickHouse returned HTTP ' +
						response.status +
						': ' +
						body.slice(0, 512)
				);
			}
			const parsed: unknown = JSON.parse(body);
			if (parsed === null || typeof parsed !== 'object') {
				throw new HubbleWarehouseUnavailableError(
					'ClickHouse returned an invalid JSON response'
				);
			}
			return parsed as HubblePreparedResponse<T>;
		} catch (error) {
			if (error instanceof HubbleWarehouseUnavailableError) throw error;
			throw new HubbleWarehouseUnavailableError(
				'Hubble ClickHouse query failed',
				{ cause: error }
			);
		}
	};
}
