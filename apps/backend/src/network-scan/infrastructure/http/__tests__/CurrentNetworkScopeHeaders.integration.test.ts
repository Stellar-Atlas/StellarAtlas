import express from 'express';
import { mockDeep } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import request from 'supertest';
import { nodeRouter, type NodeRouterConfig } from '../NodeRouter.js';
import {
	organizationRouter,
	type OrganizationRouterConfig
} from '../OrganizationRouter.js';

describe('current network scope headers', () => {
	it('labels the legacy current-node inventory', async () => {
		const config = mockDeep<NodeRouterConfig>();
		config.getNodes.execute.mockResolvedValue(ok([]));
		const app = express();
		app.use('/nodes', nodeRouter(config));

		await request(app)
			.get('/nodes')
			.expect(200)
			.expect('X-StellarAtlas-Inventory-Scope', 'current-network');
	});

	it('labels the legacy current-organization inventory', async () => {
		const config = mockDeep<OrganizationRouterConfig>();
		config.getOrganizations.execute.mockResolvedValue(ok([]));
		const app = express();
		app.use('/organizations', organizationRouter(config));

		await request(app)
			.get('/organizations')
			.expect(200)
			.expect('X-StellarAtlas-Inventory-Scope', 'current-network');
	});
});
