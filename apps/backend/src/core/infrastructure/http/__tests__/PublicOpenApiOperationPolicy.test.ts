import openApiDocument from '../../../../../openapi.json' with { type: 'json' };
import { createPublicOpenApiDocument } from '../PublicOpenApiDocument.js';
import { isPublicOpenApiOperation } from '../OpenApiOperationClassification.js';

describe('reviewed consumer OpenAPI policy', () => {
	it.each([
		'/v1/status/archive-queue',
		'/v1/status/workers',
		'/v1/status/scan-logs',
		'/v1/status/rollups',
		'/v1/status/failover',
		'/v1/archive-scans/workers',
		'/v1/indexing/jobs',
		'/v1/scp/evidence/animation-backlog'
	])(
		'omits implementation telemetry %s without removing its source definition',
		(path) => {
			const document = createPublicOpenApiDocument(openApiDocument);
			expect(document.paths).not.toHaveProperty(path);
			expect(Object.keys(openApiDocument.paths)).toContain(path);
		}
	);
	it('keeps explicit public evidence, data and overview operations', () => {
		const document = createPublicOpenApiDocument(openApiDocument);
		for (const path of [
			'/v1/status',
			'/v1/known/nodes/{publicKey}/archive-evidence',
			'/v1/archive-scans/{encodedUrl}/repair-plan',
			'/v2/archive-scans/{encodedUrl}/object-evidence',
			'/v1/analytics/query',
			'/v1/analytics/accounts/{account}/balances',
			'/graphql',
			'/rpc'
		]) {
			expect(document.paths).toHaveProperty(path);
		}
	});
	it('fails closed for future unannotated routes and reused names on a different path/method', () => {
		expect(
			isPublicOpenApiOperation({
				method: 'get',
				path: '/v1/new-internal',
				operation: { operationId: 'newInternal' }
			})
		).toBe(false);
		expect(
			isPublicOpenApiOperation({
				method: 'get',
				path: '/v1/new-internal',
				operation: { operationId: 'getNetwork', security: [] }
			})
		).toBe(false);
		expect(
			isPublicOpenApiOperation({
				method: 'delete',
				path: '/v1',
				operation: { operationId: 'getNetwork', security: [] }
			})
		).toBe(false);
		expect(
			isPublicOpenApiOperation({ method: 'get', path: '/v1', operation: {} })
		).toBe(false);
	});
	it.each([
		{ security: [{ basicAuth: [] }] },
		{ 'x-internal': true },
		{ deprecated: true }
	])(
		'never overrides a protected or historical declaration %j',
		(restriction) => {
			expect(
				isPublicOpenApiOperation({
					method: 'get',
					path: '/v1',
					operation: { operationId: 'getNetwork', ...restriction }
				})
			).toBe(false);
		}
	);
});
