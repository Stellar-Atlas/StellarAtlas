import openApiDocument from '../../../../../openapi.json' with { type: 'json' };
import { StellarAtlasApiDocsSourceAdapter } from '../StellarAtlasApiDocsSourceAdapter.js';

describe('StellarAtlasApiDocsSourceAdapter', () => {
	it('should extract operation metadata from a StellarAtlas OpenAPI document', () => {
		const adapter = new StellarAtlasApiDocsSourceAdapter(
			createOpenApiDocument(),
			() => new Date('2026-07-03T12:00:00.000Z')
		);

		const result = adapter.readDocs();

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toEqual({
			documentationUrl: '/docs',
			loadedAt: '2026-07-03T12:00:00.000Z',
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
					method: 'post',
					operationId: null,
					path: '/v1/community-scanners/register',
					schemaRefs: [
						'#/components/schemas/CommunityScannerRegistrationRequest',
						'#/components/schemas/CommunityScannerRegistrationResponse'
					],
					summary: 'Register scanner',
					tags: ['CommunityScanners']
				}
			],
			sourceId: 'stellaratlas-api',
			title: 'StellarAtlas.io API',
			version: 'v1'
		});
	});

	it('should parse the checked-in backend OpenAPI document', () => {
		const adapter = new StellarAtlasApiDocsSourceAdapter(
			openApiDocument,
			() => new Date('2026-07-03T12:00:00.000Z')
		);

		const result = adapter.readDocs();

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.operations.length).toBeGreaterThan(10);
		expect(result.value.operations).toContainEqual(
			expect.objectContaining({
				method: 'get',
				operationId: 'getCrossCheckSources',
				path: '/v1/cross-check/sources'
			})
		);
	});

	it('should reject malformed OpenAPI documents', () => {
		const adapter = new StellarAtlasApiDocsSourceAdapter({
			info: { title: 'StellarAtlas.io API' }
		});

		const result = adapter.readDocs();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toEqual({
			kind: 'invalid_openapi',
			message: 'StellarAtlas OpenAPI doc is missing openapi version'
		});
	});
});

function createOpenApiDocument(): Record<string, unknown> {
	return {
		openapi: '3.0.3',
		info: {
			title: 'StellarAtlas.io API',
			version: 'v1'
		},
		paths: {
			'/v1/community-scanners/register': {
				post: {
					operationId: '',
					requestBody: {
						content: {
							'application/json': {
								schema: {
									$ref: '#/components/schemas/CommunityScannerRegistrationRequest'
								}
							}
						}
					},
					responses: {
						'200': {
							content: {
								'application/json': {
									schema: {
										$ref: '#/components/schemas/CommunityScannerRegistrationResponse'
									}
								}
							}
						}
					},
					summary: 'Register scanner',
					tags: ['CommunityScanners']
				}
			},
			'/v1': {
				get: {
					operationId: 'getNetwork',
					responses: {
						'200': {
							content: {
								'application/json': {
									schema: { $ref: '#/components/schemas/Network' }
								}
							}
						}
					},
					summary: 'Network',
					tags: ['Network']
				}
			}
		}
	};
}
