import { createPublicOpenApiDocument } from '../PublicOpenApiDocument.js';
import { isPublicOpenApiOperation } from '../OpenApiOperationClassification.js';
import { readOpenApiRecord } from '../OpenApiDocumentProjection.js';

const path = '/v1/issuer-domains/{domain}';
const operationId = 'getIssuerDomainEvidence';

test('publishes the exact issuer-domain route with bounded evidence and unchanged anonymous access', () => {
	const document = createPublicOpenApiDocument({
		openapi: '3.0.3',
		info: {},
		paths: {}
	});
	const pathItem = readOpenApiRecord(readOpenApiRecord(document.paths)?.[path]);
	expect(pathItem).toMatchObject({
		get: {
			operationId,
			tags: ['Assets'],
			security: [],
			parameters: [
				{
					name: 'domain',
					in: 'path',
					required: true,
					schema: { type: 'string', maxLength: 254 }
				}
			],
			responses: {
				'200': {
					content: {
						'application/json': {
							schema: {
								properties: {
									homeDomainIndex: {
										enum: ['available', 'partial', 'unavailable']
									},
									catalogue: {
										properties: {
											status: { enum: ['available', 'partial', 'unavailable'] }
										}
									},
									toml: {
										properties: {
											status: { enum: ['available', 'stale', 'unavailable'] }
										}
									},
									accounts: {
										maxItems: 25,
										items: {
											properties: {
												association: {
													enum: [
														'corroborated',
														'mismatch',
														'indexed_only',
														'toml_only',
														'unavailable'
													]
												},
												assets: { maxItems: 20 },
												assetsTruncated: { type: 'boolean' }
											}
										}
									},
									accountsTruncated: { type: 'boolean' }
								}
							}
						}
					}
				},
				'400': { description: 'Invalid issuer hostname.' },
				'503': { description: 'Lookup busy or temporarily unavailable.' }
			}
		}
	});
	expect(pathItem).not.toHaveProperty('post');
});

test('the exact projection binding cannot publish a different method, path or protected operation', () => {
	const operation = { operationId, security: [] };
	expect(isPublicOpenApiOperation({ method: 'get', path, operation })).toBe(
		true
	);
	expect(isPublicOpenApiOperation({ method: 'post', path, operation })).toBe(
		false
	);
	expect(
		isPublicOpenApiOperation({
			method: 'get',
			path: '/v1/other/{domain}',
			operation
		})
	).toBe(false);
	expect(
		isPublicOpenApiOperation({
			method: 'get',
			path,
			operation: { operationId, security: [{ basicAuth: [] }] }
		})
	).toBe(false);
});
