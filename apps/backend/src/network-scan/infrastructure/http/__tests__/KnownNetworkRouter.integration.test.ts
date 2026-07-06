import express from 'express';
import request from 'supertest';
import { mockDeep } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { createDummyNodeV1 } from '@network-scan/services/__fixtures__/createDummyNodeV1.js';
import { createDummyOrganizationV1 } from '@network-scan/services/__fixtures__/createDummyOrganizationV1.js';
import { knownNetworkRouter } from '../KnownNetworkRouter.js';
import type { KnownNetworkRouterConfig } from '../KnownNetworkRouter.js';

describe('KnownNetworkRouter.integration', () => {
	it('exposes a known node by public key', async () => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		const node = createDummyNodeV1();
		config.getKnownNode.execute.mockResolvedValue(
			ok({
				publicKey: node.publicKey,
				dateDiscovered: '2020-01-01T00:00:00.000Z',
				node,
				metadataState: 'snapshot',
				current: true,
				snapshotStartDate: '2020-01-01T00:00:00.000Z',
				snapshotEndDate: null,
				lastSeen: '2020-01-01T00:00:00.000Z',
				lastMeasurementAt: '2020-01-01T00:00:00.000Z'
			})
		);

		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app)
			.get(`/known/nodes/${node.publicKey}`)
			.expect(200)
			.expect('Cache-Control', 'public, max-age=30')
			.expect((response) => {
				expect(response.body.publicKey).toBe(node.publicKey);
				expect(response.body.node.publicKey).toBe(node.publicKey);
			});
	});

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

	it('returns not found for missing known nodes', async () => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		config.getKnownNode.execute.mockResolvedValue(ok(null));

		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app)
			.get('/known/nodes/not-a-known-node')
			.expect(404)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Known node not found' });
			});
	});

	it('exposes a known organization by id', async () => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		const organization = createDummyOrganizationV1();
		config.getKnownOrganization.execute.mockResolvedValue(
			ok({
				organization,
				current: true,
				snapshotStartDate: '2020-01-01T00:00:00.000Z',
				snapshotEndDate: null,
				lastSeen: '2020-01-01T00:00:00.000Z',
				lastMeasurementAt: '2020-01-01T00:00:00.000Z'
			})
		);

		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app)
			.get(`/known/organizations/${organization.id}`)
			.expect(200)
			.expect('Cache-Control', 'public, max-age=30')
			.expect((response) => {
				expect(response.body.organization.id).toBe(organization.id);
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

	it('returns not found for missing known organizations', async () => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		config.getKnownOrganization.execute.mockResolvedValue(ok(null));

		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app)
			.get('/known/organizations/missing')
			.expect(404)
			.expect((response) => {
				expect(response.body).toEqual({
					error: 'Known organization not found'
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
