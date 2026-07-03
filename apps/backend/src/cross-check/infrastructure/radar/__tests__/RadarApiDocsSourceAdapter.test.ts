import {
	RadarApiDocsSourceAdapter,
	type RadarApiDocsFetch
} from '../RadarApiDocsSourceAdapter.js';

describe('RadarApiDocsSourceAdapter', () => {
	it('should fetch and parse RADAR API docs with bounded request options', async () => {
		let observedRequest:
			{ input: string | URL; init?: RequestInit } | undefined;
		const fetchFn: RadarApiDocsFetch = async (input, init) => {
			observedRequest = { input, init };
			return new Response(createSwaggerInitializer(), { status: 200 });
		};
		const adapter = new RadarApiDocsSourceAdapter(
			fetchFn,
			() => new Date('2026-07-03T12:00:00.000Z')
		);

		const result = await adapter.fetchDocs({
			timeoutMs: 250
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toMatchObject({
			assetUrl: 'https://radar.withobsrvr.com/api/docs/swagger-ui-init.js',
			documentationUrl: 'https://radar.withobsrvr.com/api/docs/',
			fetchedAt: '2026-07-03T12:00:00.000Z',
			openapiVersion: '3.0.3',
			sourceId: 'withobsrvr-radar'
		});
		expect(result.value.contentHashSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(result.value.operations).toEqual([
			{
				method: 'get',
				operationId: null,
				path: '/v1',
				schemaRefs: [],
				summary: null,
				tags: []
			}
		]);
		expect(observedRequest?.input).toBe(
			'https://radar.withobsrvr.com/api/docs/swagger-ui-init.js'
		);
		expect(observedRequest?.init?.headers).toEqual({
			accept: 'application/javascript, text/javascript, */*'
		});
		expect(observedRequest?.init?.signal).toBeInstanceOf(AbortSignal);
	});

	it('should return an error for non-successful RADAR responses', async () => {
		const fetchFn: RadarApiDocsFetch = async () =>
			new Response('unavailable', { status: 503 });
		const adapter = new RadarApiDocsSourceAdapter(fetchFn);

		const result = await adapter.fetchDocs();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().kind).toBe('http_status');
		expect(result._unsafeUnwrapErr().status).toBe(503);
		expect(result._unsafeUnwrapErr().message).toBe(
			'RADAR API docs returned HTTP 503'
		);
	});

	it('should reject responses that exceed the configured byte cap', async () => {
		const fetchFn: RadarApiDocsFetch = async () =>
			new Response(createSwaggerInitializer(), { status: 200 });
		const adapter = new RadarApiDocsSourceAdapter(fetchFn);

		const result = await adapter.fetchDocs({ maxBytes: 10 });

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().kind).toBe('max_bytes_exceeded');
		expect(result._unsafeUnwrapErr().limitBytes).toBe(10);
		expect(result._unsafeUnwrapErr().message).toBe(
			'RADAR API docs response exceeded 10 bytes'
		);
	});

	it('should map fetch failures into Result errors', async () => {
		const fetchFn: RadarApiDocsFetch = async () => {
			throw new Error('network unavailable');
		};
		const adapter = new RadarApiDocsSourceAdapter(fetchFn);

		const result = await adapter.fetchDocs();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().kind).toBe('network_error');
		expect(result._unsafeUnwrapErr().message).toBe('network unavailable');
	});
});

function createSwaggerInitializer(): string {
	return `window.ui = SwaggerUIBundle({
		"swaggerDoc": {
			"openapi": "3.0.3",
			"info": { "title": "RADAR API", "version": "1.0.0" },
			"servers": [{ "url": "https://radar.withobsrvr.com/api" }],
			"tags": [{ "name": "Network" }],
			"paths": { "/v1": { "get": {} } }
		}
	});`;
}
