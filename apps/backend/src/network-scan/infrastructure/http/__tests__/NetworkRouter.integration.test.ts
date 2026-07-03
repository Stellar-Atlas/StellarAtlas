import express from 'express';
import request from 'supertest';
import { mockDeep } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import { networkRouter } from '../NetworkRouter.js';
import type { NetworkRouterConfig } from '../NetworkRouter.js';
import { createDummyNetworkV1 } from '@network-scan/services/__fixtures__/createDummyNetworkV1.js';
import { createDummyNodeV1 } from '@network-scan/services/__fixtures__/createDummyNodeV1.js';
import { createDummyOrganizationV1 } from '@network-scan/services/__fixtures__/createDummyOrganizationV1.js';

describe('NetworkRouter.integration', () => {
	it('should expose current network snapshots with frontend-aligned cache age', async () => {
		const config = mockDeep<NetworkRouterConfig>();
		config.searchConfig = { indexName: 'test_network_entities' };
		config.getNetwork.execute.mockResolvedValue(
			ok({
				name: 'Public Stellar Network'
			} as never)
		);

		const app = express();
		app.use('/network', networkRouter(config));

		await request(app)
			.get('/network')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body.name).toBe('Public Stellar Network');
			});
	});

	it('should expose faceted search results from the current network snapshot', async () => {
		const organization = createDummyOrganizationV1();
		organization.id = 'sdf';
		organization.name = 'Stellar Development Foundation';
		organization.homeDomain = 'stellar.org';

		const node = createDummyNodeV1('GA_SEARCH_NODE');
		node.name = 'SDF Validator 1';
		node.homeDomain = 'stellar.org';
		node.organizationId = organization.id;
		organization.validators = [node.publicKey];

		const config = mockDeep<NetworkRouterConfig>();
		config.searchConfig = { indexName: 'test_network_entities' };
		config.getNetwork.execute.mockResolvedValue(
			ok(createDummyNetworkV1([node], [organization]))
		);

		const app = express();
		app.use('/network', networkRouter(config));

		await request(app)
			.get('/network/search?q=stellar&limit=8')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=5')
			.expect((response) => {
				expect(response.body.hits).toHaveLength(2);
				expect(response.body.facets.entityType).toEqual([
					{ count: 1, value: 'node' },
					{ count: 1, value: 'organization' }
				]);
				expect(response.body.source).toBe('memory');
			});
	});

	it('should expose node-only search through a fixed route', async () => {
		const organization = createDummyOrganizationV1();
		organization.id = 'sdf';
		organization.name = 'Stellar Development Foundation';

		const node = createDummyNodeV1('GA_SEARCH_NODE');
		node.name = 'SDF Validator 1';
		node.organizationId = organization.id;
		organization.validators = [node.publicKey];

		const config = mockDeep<NetworkRouterConfig>();
		config.searchConfig = { indexName: 'test_network_entities' };
		config.getNetwork.execute.mockResolvedValue(
			ok(createDummyNetworkV1([node], [organization]))
		);

		const app = express();
		app.use('/network', networkRouter(config));

		await request(app)
			.get('/network/search/nodes?q=sdf')
			.expect(200)
			.expect((response) => {
				expect(response.body.hits).toHaveLength(1);
				expect(response.body.hits[0].entityType).toBe('node');
			});
	});

	it.each([
		'/network/search?limit=0',
		'/network/search?limit=26',
		'/network/search?limit=1.5',
		'/network/search?type=validator',
		'/network/search?archiveStatus=degraded',
		'/network/search?validator=yes',
		`/network/search?q=${'a'.repeat(129)}`
	])('should reject invalid search query %s', async (path) => {
		const config = mockDeep<NetworkRouterConfig>();
		config.searchConfig = { indexName: 'test_network_entities' };

		const app = express();
		app.use('/network', networkRouter(config));

		await request(app).get(path).expect(400);
		expect(config.getNetwork.execute).not.toHaveBeenCalled();
	});
});
