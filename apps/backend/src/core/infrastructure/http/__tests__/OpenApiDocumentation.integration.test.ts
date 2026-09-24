import express from 'express';
import request from 'supertest';
import openApiDocument from '../../../../../openapi.json' with { type: 'json' };
import { mountOpenApiDocumentation } from '../OpenApiDocumentation.js';

function createApp(document: unknown = openApiDocument) {
	const app = express();
	app.get('/v1/node', (_req, res) => res.json({ legacyApi: 'unchanged' }));
	mountOpenApiDocumentation(app, { document });
	return app;
}

describe('one public documentation UI', () => {
	it('serves the reviewed consumer JSON contract without altering legacy data APIs', async () => {
		const app = createApp();
		const response = await request(app).get('/docs/openapi.json').expect(200);
		expect(response.body.info.title).toBe('StellarAtlas Public API');
		expect(response.body.paths['/v1/known/nodes']).toBeDefined();
		expect(response.body.paths['/v1/history-scan/job']).toBeUndefined();
		expect(response.body.paths['/v1/status/archive-queue']).toBeUndefined();
		await request(app).get('/v1/node').expect(200, { legacyApi: 'unchanged' });
	});
	it.each([
		'/docs',
		'/docs/',
		'/docs/operators',
		'/docs/operators/',
		'/docs/historical',
		'/docs/historical/'
	])('redirects the old HTML entry %s to the sole docs UI', async (path) => {
		const response = await request(createApp()).get(path).expect(307);
		expect(response.headers.location).toBe('https://stellaratlas.io/docs');
		expect(response.text).not.toContain('swagger-ui');
	});
	it.each([
		'/docs/operators/openapi.json',
		'/docs/historical/openapi.json',
		'/docs/swagger-ui.css',
		'/docs/swagger-ui-init.js',
		'/docs/operators/swagger-ui.css'
	])('does not serve or redirect retired document/asset %s', async (path) => {
		await request(createApp()).get(path).expect(404);
		await request(createApp()).get(path).auth('operator', 'secret').expect(404);
	});
	it('cannot expose an injected deprecated privileged operation through a retired spec', async () => {
		const app = createApp({
			...openApiDocument,
			paths: {
				...openApiDocument.paths,
				'/v1/retired-maintenance': {
					post: {
						operationId: 'retiredMaintenance',
						deprecated: true,
						security: [{ basicAuth: [] }],
						'x-internal': true
					}
				}
			}
		});
		const response = await request(app).get('/docs/openapi.json').expect(200);
		expect(response.body.paths['/v1/retired-maintenance']).toBeUndefined();
		await request(app).get('/docs/historical/openapi.json').expect(404);
		await request(app).get('/docs/operators/openapi.json').expect(404);
	});
});
