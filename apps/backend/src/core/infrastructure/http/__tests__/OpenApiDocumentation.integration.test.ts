import express from 'express';
import request from 'supertest';
import openApiDocument from '../../../../../openapi.json' with { type: 'json' };
import { mountOpenApiDocumentation } from '../OpenApiDocumentation.js';

describe('OpenAPI documentation routes', () => {
	it('serves consumer JSON publicly and historical compatibility JSON only to operators', async () => {
		const app = express();
		mountOpenApiDocumentation(app, {
			document: openApiDocument,
			operatorPassword: 'secret',
			operatorUserName: 'operator'
		});

		const publicResponse = await request(app)
			.get('/docs/openapi.json')
			.expect(200);
		expect(publicResponse.body.info.title).toBe('StellarAtlas Public API');
		expect(publicResponse.body.paths['/v1/history-scan/job']).toBeUndefined();

		const historicalResponse = await request(app)
			.get('/docs/historical/openapi.json')
			.auth('operator', 'secret')
			.expect(200);
		expect(historicalResponse.body.info.title).toBe(
			'StellarAtlas Historical Compatibility API'
		);
		expect(historicalResponse.body.paths['/v1/node']).toBeDefined();
	});

	it.each([
		'/docs/historical/openapi.json',
		'/docs/historical/',
		'/docs/historical/swagger-ui.css',
		'/docs/operators/openapi.json',
		'/docs/operators/',
		'/docs/operators/swagger-ui.css'
	])('guards non-consumer documentation at %s', async (path) => {
		const app = express();
		mountOpenApiDocumentation(app, {
			document: openApiDocument,
			operatorUserName: 'operator',
			operatorPassword: 'secret'
		});
		await request(app).get(path).expect(401);
		await request(app).get(path).auth('operator', 'wrong').expect(401);
	});

	it('requires configured operator credentials for the operator document', async () => {
		const app = express();
		mountOpenApiDocumentation(app, {
			document: openApiDocument,
			operatorPassword: 'secret',
			operatorUserName: 'operator'
		});

		await request(app).get('/docs/operators/openapi.json').expect(401);
		await request(app)
			.get('/docs/operators/openapi.json')
			.auth('operator', 'wrong')
			.expect(401);
		const response = await request(app)
			.get('/docs/operators/openapi.json')
			.auth('operator', 'secret')
			.expect(200);

		expect(response.body.info.title).toBe('StellarAtlas Operator API');
		expect(response.body.paths['/v1/history-scan/job']).toBeDefined();
		expect(response.body.paths['/v1']).toBeUndefined();
	});

	it('does not expose operator docs when credentials are not configured', async () => {
		const app = express();
		mountOpenApiDocumentation(app, { document: openApiDocument });

		await request(app).get('/docs/operators/openapi.json').expect(404);
		await request(app).get('/docs/historical/openapi.json').expect(404);
	});
});
