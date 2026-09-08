import { jest } from '@jest/globals';
import { getIntrospectionQuery, type FormattedExecutionResult } from 'graphql';
import {
	createGraphqlIdeTransport,
	isSchemaRequest
} from '../graphql-ide-fetcher';

function iterator(
	value: ReturnType<ReturnType<typeof createGraphqlIdeTransport>['fetcher']>
) {
	if (!value || typeof value !== 'object' || !(Symbol.asyncIterator in value))
		throw new Error('Expected cancelable iterator');
	return (value as AsyncIterable<FormattedExecutionResult>)[
		Symbol.asyncIterator
	]();
}
function response(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}
const query = '{ hubbleStatus { datasetCount } }';
describe('GraphiQL HTTP transport', () => {
	it('does not execute on construction and sends one public same-origin request when consumed', async () => {
		const request = jest
			.fn<typeof fetch>()
			.mockResolvedValue(
				response({ data: { hubbleStatus: { datasetCount: 10 } } })
			);
		const onResult = jest.fn();
		const transport = createGraphqlIdeTransport({ request, onResult });
		expect(request).not.toHaveBeenCalled();
		const stream = iterator(
			transport.fetcher(
				{ query, variables: { input: { limit: 10 } } },
				{ headers: { authorization: 'must-not-send' } }
			)
		);
		expect(request).not.toHaveBeenCalled();
		const first = await stream.next();
		expect(first.done).toBe(false);
		expect(request).toHaveBeenCalledTimes(1);
		const call = request.mock.calls[0];
		if (!call) throw new Error('Expected HTTP request');
		expect(call[0]).toBe('/graphql');
		expect(call[1]).toMatchObject({
			method: 'POST',
			credentials: 'omit'
		});
		expect(call[1]?.headers).not.toHaveProperty('authorization');
		expect(JSON.parse(String(call[1]?.body))).toEqual({
			query,
			variables: { input: { limit: 10 } }
		});
		expect(onResult).toHaveBeenCalledWith(
			expect.objectContaining({ status: 200, schemaRequest: false })
		);
		expect((await stream.next()).done).toBe(true);
		expect(request).toHaveBeenCalledTimes(1);
	});
	it('retains error payload and actual HTTP status instead of claiming success', async () => {
		const onResult = jest.fn();
		const transport = createGraphqlIdeTransport({
			request: jest
				.fn<typeof fetch>()
				.mockResolvedValue(
					response({ errors: [{ message: 'Warehouse unavailable' }] }, 503)
				),
			onResult
		});
		expect((await iterator(transport.fetcher({ query })).next()).value).toEqual(
			{ errors: [{ message: 'Warehouse unavailable' }] }
		);
		expect(onResult).toHaveBeenCalledWith(
			expect.objectContaining({ status: 503 })
		);
	});
	it.each([
		[new Response('<html>Unavailable</html>', { status: 503 }), 'non-JSON'],
		[response({ unexpected: true }), 'invalid GraphQL']
	])(
		'reports invalid endpoint responses without retrying',
		async (reply, message) => {
			const request = jest.fn<typeof fetch>().mockResolvedValue(reply);
			await expect(
				iterator(
					createGraphqlIdeTransport({ request }).fetcher({ query })
				).next()
			).rejects.toThrow(message);
			expect(request).toHaveBeenCalledTimes(1);
		}
	);
	it('aborts immediately on Stop even while the response is pending', async () => {
		let signal: AbortSignal | undefined;
		const request = jest.fn<typeof fetch>().mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					signal = init?.signal ?? undefined;
					signal?.addEventListener(
						'abort',
						() => reject(new Error('aborted')),
						{ once: true }
					);
				})
		);
		const stream = iterator(
			createGraphqlIdeTransport({ request }).fetcher({ query })
		);
		const pending = stream.next().catch((error: unknown) => error);
		await stream.return?.();
		expect(signal?.aborted).toBe(true);
		expect(await pending).toEqual(
			expect.objectContaining({ message: expect.stringContaining('canceled') })
		);
		expect(request).toHaveBeenCalledTimes(1);
	});
	it('disposes outstanding requests on unmount', async () => {
		let signal: AbortSignal | undefined;
		const request = jest.fn<typeof fetch>().mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					signal = init?.signal ?? undefined;
					signal?.addEventListener(
						'abort',
						() => reject(new Error('aborted')),
						{ once: true }
					);
				})
		);
		const transport = createGraphqlIdeTransport({ request });
		const pending = iterator(transport.fetcher({ query }))
			.next()
			.catch((error: unknown) => error);
		transport.dispose();
		expect(signal?.aborted).toBe(true);
		await pending;
	});
	it('bounds request duration and clears the busy state on timeout', async () => {
		jest.useFakeTimers();
		try {
			const onBusy = jest.fn();
			const request = jest.fn<typeof fetch>().mockImplementation(
				(_url, init) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener(
							'abort',
							() => reject(new Error('aborted')),
							{ once: true }
						);
					})
			);
			const pending = iterator(
				createGraphqlIdeTransport({ request, onBusy }).fetcher({ query })
			)
				.next()
				.catch((error: unknown) => error);
			await jest.advanceTimersByTimeAsync(20_001);
			expect(await pending).toEqual(
				expect.objectContaining({
					message: expect.stringContaining('20-second')
				})
			);
			expect(onBusy.mock.calls).toEqual([[true], [false]]);
		} finally {
			jest.useRealTimers();
		}
	});
	it('caches only the completed schema request, never data queries', async () => {
		const request = jest
			.fn<typeof fetch>()
			.mockImplementation(async () => response({ data: { __schema: {} } }));
		const onBusy = jest.fn();
		const transport = createGraphqlIdeTransport({ request, onBusy });
		const schema = getIntrospectionQuery();
		await iterator(transport.fetcher({ query: schema })).next();
		await iterator(transport.fetcher({ query: schema })).next();
		expect(request).toHaveBeenCalledTimes(1);
		expect(onBusy).not.toHaveBeenCalled();
		await iterator(transport.fetcher({ query })).next();
		await iterator(transport.fetcher({ query })).next();
		expect(request).toHaveBeenCalledTimes(3);
	});
	it('does not classify an operation as schema-only by its name', () => {
		expect(isSchemaRequest(getIntrospectionQuery())).toBe(true);
		expect(
			isSchemaRequest(
				'query IntrospectionQuery { hubbleStatus { datasetCount } }'
			)
		).toBe(false);
		expect(
			isSchemaRequest(
				'{ __schema { queryType { name } } hubbleStatus { datasetCount } }'
			)
		).toBe(false);
		expect(isSchemaRequest('bad')).toBe(false);
	});
});
