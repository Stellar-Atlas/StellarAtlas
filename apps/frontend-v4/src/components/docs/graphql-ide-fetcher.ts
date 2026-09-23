import {
	Kind,
	getOperationAST,
	parse,
	type FormattedExecutionResult
} from 'graphql';
import type { GraphiQLProps } from 'graphiql';
import { isRecord } from './graphql-request';

export interface GraphqlIdeResult {
	readonly result: FormattedExecutionResult;
	readonly query: string;
	readonly variables: string;
	readonly status: number;
	readonly elapsedMilliseconds: number;
	readonly schemaRequest: boolean;
}

interface TransportOptions {
	readonly request?: typeof fetch;
	readonly timeoutMilliseconds?: number;
	readonly onBusy?: (busy: boolean) => void;
	readonly onResult?: (result: GraphqlIdeResult) => void;
	readonly onError?: (message: string, schemaRequest: boolean) => void;
}

export function isSchemaRequest(
	query: string,
	operationName?: string | null
): boolean {
	try {
		const operation = getOperationAST(parse(query), operationName);
		return (
			operation?.operation === 'query' &&
			operation.selectionSet.selections.length > 0 &&
			operation.selectionSet.selections.every(
				(selection) =>
					selection.kind === Kind.FIELD &&
					['__schema', '__type', '__typename'].includes(selection.name.value)
			)
		);
	} catch {
		return false;
	}
}

function isExecutionResult(value: unknown): value is FormattedExecutionResult {
	if (!isRecord(value) || (!('data' in value) && !('errors' in value)))
		return false;
	if ('data' in value && value.data !== null && !isRecord(value.data))
		return false;
	if (
		'errors' in value &&
		(!Array.isArray(value.errors) ||
			!value.errors.every(
				(error) => isRecord(error) && typeof error.message === 'string'
			))
	)
		return false;
	return true;
}

/** One local HTTP request per execution; no retries, credentials, sockets, or data prefetch. */
export function createGraphqlIdeTransport(options: TransportOptions = {}): {
	readonly fetcher: GraphiQLProps['fetcher'];
	readonly dispose: () => void;
} {
	const request = options.request ?? fetch;
	const controllers = new Set<AbortController>();
	let schemaCache:
		{ key: string; result: FormattedExecutionResult } | undefined;
	const fetcher: GraphiQLProps['fetcher'] = (parameters) => {
		const schemaRequest = isSchemaRequest(
			parameters.query,
			parameters.operationName
		);
		const key = JSON.stringify(parameters);
		const controller = new AbortController();
		let delivered = false;
		let canceled = false;
		const cached =
			schemaRequest && schemaCache?.key === key
				? schemaCache.result
				: undefined;
		const execute = async (): Promise<FormattedExecutionResult> => {
			if (cached) return cached;
			controllers.add(controller);
			if (!schemaRequest) options.onBusy?.(true);
			const started = performance.now();
			const timeout = setTimeout(
				() => controller.abort(),
				options.timeoutMilliseconds ?? 20_000
			);
			try {
				const response = await request('/graphql', {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						accept: 'application/graphql-response+json, application/json'
					},
					credentials: 'omit',
					signal: controller.signal,
					body: JSON.stringify({
						query: parameters.query,
						variables: parameters.variables,
						operationName: parameters.operationName
					})
				});
				const text = await response.text();
				let result: unknown;
				try {
					result = JSON.parse(text);
				} catch {
					throw new Error(
						'HTTP ' +
							response.status +
							': the endpoint returned a non-JSON response.'
					);
				}
				if (!isExecutionResult(result)) {
					throw new Error(
						'HTTP ' +
							response.status +
							': the endpoint returned an invalid GraphQL response.'
					);
				}
				if (!response.ok && !result.errors?.length) {
					throw new Error(
						'HTTP ' + response.status + ': the GraphQL request failed.'
					);
				}
				if (schemaRequest && response.ok && !result.errors?.length)
					schemaCache = { key, result };
				if (!canceled)
					options.onResult?.({
						result,
						query: parameters.query,
						variables: JSON.stringify(parameters.variables ?? {}, null, 2),
						status: response.status,
						elapsedMilliseconds: Math.round(performance.now() - started),
						schemaRequest
					});
				return result;
			} catch (error) {
				const message = controller.signal.aborted
					? 'Request canceled or exceeded the ' +
						(options.timeoutMilliseconds ?? 20_000) / 1000 +
						'-second browser timeout.'
					: error instanceof Error
						? error.message
						: 'GraphQL request failed.';
				options.onError?.(message, schemaRequest);
				throw new Error(message);
			} finally {
				clearTimeout(timeout);
				controllers.delete(controller);
				if (!schemaRequest) options.onBusy?.(false);
			}
		};
		// GraphiQL unsubscribes via iterator.return(). Abort immediately, even while next() awaits fetch.
		let pending: Promise<FormattedExecutionResult> | undefined;
		const iterator: AsyncIterableIterator<FormattedExecutionResult> = {
			[Symbol.asyncIterator]() {
				return iterator;
			},
			async next() {
				if (delivered || canceled) return { done: true, value: undefined };
				delivered = true;
				pending ??= execute();
				return { done: false, value: await pending };
			},
			async return() {
				canceled = true;
				controller.abort();
				return { done: true, value: undefined };
			}
		};
		return iterator;
	};
	return {
		fetcher,
		dispose() {
			for (const controller of controllers) controller.abort();
			controllers.clear();
			schemaCache = undefined;
		}
	};
}
