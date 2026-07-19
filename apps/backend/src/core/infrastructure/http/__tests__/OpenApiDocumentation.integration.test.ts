import express from 'express';
import request from 'supertest';
import openApiDocument from '../../../../../openapi.json' with { type: 'json' };
import { mountOpenApiDocumentation } from '../OpenApiDocumentation.js';

describe('OpenAPI documentation routes', () => {
	it('serves the curated public and historical JSON documents without auth', async () => {
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
			.expect(200);
		expect(historicalResponse.body.info.title).toBe(
			'StellarAtlas Historical Compatibility API'
		);
		expect(historicalResponse.body.paths['/v1/node']).toBeDefined();
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
	});
});
