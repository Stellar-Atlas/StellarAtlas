import openApiDocument from '../../../../../openapi.json' with { type: 'json' };

describe('OpenAPI authentication schemes', () => {
	it('defines the schemes referenced by protected scanner operations', () => {
		expect(openApiDocument.components.securitySchemes).toMatchObject({
			basicAuth: { scheme: 'basic', type: 'http' },
			bearerAuth: { scheme: 'bearer', type: 'http' }
		});

		for (const path of [
			'/v1/community-scanners/{id}/heartbeat',
			'/v1/community-scanners/{id}/job',
			'/v1/community-scanners/{id}/job/{remoteId}/heartbeat',
			'/v1/community-scanners/{id}/scans'
		]) {
			const operation = Object.values(
				openApiDocument.paths[path as keyof typeof openApiDocument.paths]
			)[0];
			expect(operation).toMatchObject({ security: [{ bearerAuth: [] }] });
		}
	});
});
