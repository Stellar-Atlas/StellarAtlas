import express from 'express';
import request from 'supertest';
import { mockDeep } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { knownNetworkRouter } from '../KnownNetworkRouter.js';
import type { KnownNetworkRouterConfig } from '../KnownNetworkRouter.js';

describe('KnownNetworkRouter.integration', () => {
	it('exposes all-known nodes', async () => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		config.getKnownNodes.execute.mockResolvedValue(
			ok({
				generatedAt: '2020-01-01T00:00:00.000Z',
				count: 0,
				nodes: []
			})
		);

		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app)
			.get('/known/nodes')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=30')
			.expect((response) => {
				expect(response.body).toEqual({
					generatedAt: '2020-01-01T00:00:00.000Z',
					count: 0,
					nodes: []
				});
			});
	});

	it('exposes all-known organizations', async () => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		config.getKnownOrganizations.execute.mockResolvedValue(
			ok({
				generatedAt: '2020-01-01T00:00:00.000Z',
				count: 0,
				organizations: []
			})
		);

		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app)
			.get('/known/organizations')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=30')
			.expect((response) => {
				expect(response.body).toEqual({
					generatedAt: '2020-01-01T00:00:00.000Z',
					count: 0,
					organizations: []
				});
			});
	});

	it('maps use-case failures to server errors', async () => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		config.getKnownNodes.execute.mockResolvedValue(err(new Error('failed')));

		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app).get('/known/nodes').expect(500);
	});
});
