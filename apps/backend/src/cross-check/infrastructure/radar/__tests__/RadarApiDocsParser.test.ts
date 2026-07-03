import { parseRadarSwaggerInitializer } from '../RadarApiDocsParser.js';

describe('parseRadarSwaggerInitializer', () => {
	it('should extract RADAR OpenAPI source metadata without executing the initializer', () => {
		const result = parseRadarSwaggerInitializer({
			assetUrl: 'https://radar.withobsrvr.com/api/docs/swagger-ui-init.js',
			contentHashSha256: 'fixture-hash',
			documentationUrl: 'https://radar.withobsrvr.com/api/docs/',
			fetchedAt: '2026-07-03T12:00:00.000Z',
			initializer: createSwaggerInitializer()
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;

		expect(result.value).toEqual({
			assetUrl: 'https://radar.withobsrvr.com/api/docs/swagger-ui-init.js',
			contentHashSha256: 'fixture-hash',
			documentationUrl: 'https://radar.withobsrvr.com/api/docs/',
			fetchedAt: '2026-07-03T12:00:00.000Z',
			openapiVersion: '3.0.3',
			operations: [
				{
					method: 'get',
					operationId: 'getNetwork',
					path: '/v1',
					schemaRefs: ['#/components/schemas/Network'],
					summary: 'Network',
					tags: ['Network']
				},
				{
					method: 'get',
					operationId: 'getNodes',
					path: '/v1/node',
					schemaRefs: [],
					summary: null,
					tags: ['Node']
				},
				{
					method: 'post',
					operationId: null,
					path: '/v1/node',
					schemaRefs: [],
					summary: null,
					tags: []
				},
				{
					method: 'get',
					operationId: null,
					path: '/v1/node/{publicKey}',
					schemaRefs: [],
					summary: null,
					tags: ['HistoryScan']
				}
			],
			servers: [
				{
					description: 'Public',
					url: 'https://radar.withobsrvr.com/api'
				},
				{
					description: null,
					url: 'https://radar.withobsrvr.com/testnet-api'
				}
			],
			sourceId: 'withobsrvr-radar',
			title: 'RADAR API',
			version: '1.0.0',
			warnings: ['Operation tag "HistoryScan" is missing from top-level tags']
		});
	});

	it('should reject initializer text without a swaggerDoc payload', () => {
		const result = parseRadarSwaggerInitializer({
			assetUrl: 'https://radar.withobsrvr.com/api/docs/swagger-ui-init.js',
			contentHashSha256: 'fixture-hash',
			documentationUrl: 'https://radar.withobsrvr.com/api/docs/',
			fetchedAt: '2026-07-03T12:00:00.000Z',
			initializer: 'window.ui = SwaggerUIBundle({ dom_id: "#swagger-ui" });'
		});

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().kind).toBe('parse_error');
		expect(result._unsafeUnwrapErr().message).toBe(
			'RADAR Swagger initializer is missing swaggerDoc'
		);
	});

	it('should reject malformed OpenAPI documents', () => {
		const result = parseRadarSwaggerInitializer({
			assetUrl: 'https://radar.withobsrvr.com/api/docs/swagger-ui-init.js',
			contentHashSha256: 'fixture-hash',
			documentationUrl: 'https://radar.withobsrvr.com/api/docs/',
			fetchedAt: '2026-07-03T12:00:00.000Z',
			initializer: 'SwaggerUIBundle({"swaggerDoc":{"info":{"title":"RADAR"}}});'
		});

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().kind).toBe('invalid_openapi');
		expect(result._unsafeUnwrapErr().message).toBe(
			'RADAR Swagger doc is missing openapi version'
		);
	});

	it('should reject swaggerUrl-only initializers without chasing extra URLs', () => {
		const result = parseRadarSwaggerInitializer({
			assetUrl: 'https://radar.withobsrvr.com/api/docs/swagger-ui-init.js',
			contentHashSha256: 'fixture-hash',
			documentationUrl: 'https://radar.withobsrvr.com/api/docs/',
			fetchedAt: '2026-07-03T12:00:00.000Z',
			initializer: 'SwaggerUIBundle({"swaggerUrl":"/api/openapi.json"});'
		});

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().kind).toBe('unsupported_shape');
	});
});

function createSwaggerInitializer(): string {
	return `window.ui = SwaggerUIBundle({
		"dom_id": "#swagger-ui",
		"swaggerDoc": {
			"openapi": "3.0.3",
			"info": { "title": "RADAR API", "version": "1.0.0" },
			"servers": [
				{
					"description": "Public",
					"url": "https://radar.withobsrvr.com/api"
				},
				{ "url": "https://radar.withobsrvr.com/testnet-api" }
			],
			"tags": [
				{ "name": "Network" },
				{ "name": "Node" }
			],
			"paths": {
				"/v1/node/{publicKey}": {
					"get": {
						"description": "Description with literal braces: } {",
						"tags": ["HistoryScan"]
					}
				},
				"/v1/node": {
					"parameters": [],
					"get": {
						"operationId": "getNodes",
						"tags": ["Node"]
					},
					"post": {}
				},
				"/v1": {
					"get": {
						"operationId": "getNetwork",
						"summary": "Network",
						"tags": ["Network"],
						"responses": {
							"200": {
								"content": {
									"application/json": {
										"schema": { "$ref": "#/components/schemas/Network" }
									}
								}
							}
						}
					}
				}
			}
		},
		"layout": "BaseLayout"
	});`;
}
