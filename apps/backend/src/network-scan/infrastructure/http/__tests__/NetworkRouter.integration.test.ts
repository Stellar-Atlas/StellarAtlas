import express from 'express';
import request from 'supertest';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
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
		configureSearchInventory(
			config,
			createDummyNetworkV1([node], [organization]),
			[node],
			[organization]
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
				expect(response.body.source).toBe('postgres_canonical');
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
		configureSearchInventory(
			config,
			createDummyNetworkV1([node], [organization]),
			[node],
			[organization]
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
		'/network/search?offset=-1',
		'/network/search?offset=10001',
		'/network/search?type=validator',
		'/network/search?scope=current',
		'/network/search?scope=archived&scope=all-known',
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

	it('searches archived and public-key-only canonical inventory by scope', async () => {
		const archived = createDummyNodeV1('GA_ARCHIVED_SEARCH');
		archived.name = 'Archived Alpha';
		const network = createDummyNetworkV1([], []);
		const config = mockDeep<NetworkRouterConfig>();
		config.searchConfig = { indexName: 'test_network_entities' };
		config.getNetwork.execute.mockResolvedValue(ok(network));
		config.getKnownNodes.executeAll.mockResolvedValue(
			ok({
				count: 2,
				generatedAt: network.time,
				nodes: [
					knownNode(archived, 'archived', false),
					{
						current: false,
						dateDiscovered: network.time,
						lastMeasurementAt: null,
						lastSeen: network.time,
						metadataState: 'public_key_only',
						node: null,
						publicKey: 'GA_PUBLIC_KEY_ONLY_SEARCH',
						scope: 'public-key-only',
						snapshotEndDate: null,
						snapshotStartDate: null
					}
				],
				scopeTotals: {
					'all-known': 2,
					archived: 1,
					'current-validator': 0,
					listener: 0,
					'public-key-only': 1
				},
				source: 'postgres_canonical'
			})
		);
		config.getKnownOrganizations.executeAll.mockResolvedValue(
			ok(emptyKnownOrganizations(network.time))
		);

		const app = express();
		app.use('/network', networkRouter(config));

		await request(app)
			.get('/network/search/nodes?q=public&scope=public-key-only')
			.expect(200)
			.expect((response) => {
				expect(response.body.scope).toBe('public-key-only');
				expect(response.body.pagination).toMatchObject({
					total: 1,
					totalIsExact: true
				});
				expect(response.body.hits[0]).toMatchObject({
					entityId: 'GA_PUBLIC_KEY_ONLY_SEARCH',
					freshness: 'fresh',
					recordState: 'identity-only',
					scope: 'public-key-only',
					source: 'postgres_canonical'
				});
			});
	});

	it('should forward SCP statement source, order, slot, and cursor filters', async () => {
		const config = mockDeep<NetworkRouterConfig>();
		config.searchConfig = { indexName: 'test_network_entities' };
		config.getScpStatements.execute.mockResolvedValue(ok([]));

		const app = express();
		app.use('/network', networkRouter(config));

		await request(app)
			.get(
				[
					'/network/scp-statements?source=auto',
					'order=asc',
					'afterObservedAtMs=1783398400000',
					'afterStatementHash=abc123',
					'limit=25',
					'nodeId=GA_SEARCH_NODE',
					'slotIndex=63332754'
				].join('&')
			)
			.expect(200);

		expect(config.getScpStatements.execute).toHaveBeenCalledWith({
			after: {
				observedAtMs: 1783398400000,
				statementHash: 'abc123'
			},
			limit: 25,
			nodeId: 'GA_SEARCH_NODE',
			order: 'asc',
			slotIndex: '63332754',
			source: 'auto'
		});
	});

	it.each([
		'/network/scp-statements?source=archive',
		'/network/scp-statements?order=oldest',
		'/network/scp-statements?slotIndex=abc',
		'/network/scp-statements?afterObservedAtMs=1783398400000',
		'/network/scp-statements?afterStatementHash=abc123',
		'/network/scp-statements?afterObservedAtMs=abc&afterStatementHash=abc123'
	])('should reject invalid SCP statement query %s', async (path) => {
		const config = mockDeep<NetworkRouterConfig>();
		config.searchConfig = { indexName: 'test_network_entities' };

		const app = express();
		app.use('/network', networkRouter(config));

		await request(app).get(path).expect(400);
		expect(config.getScpStatements.execute).not.toHaveBeenCalled();
	});
});

function configureSearchInventory(
	config: DeepMockProxy<NetworkRouterConfig>,
	network: ReturnType<typeof createDummyNetworkV1>,
	nodes: ReturnType<typeof createDummyNodeV1>[],
	organizations: ReturnType<typeof createDummyOrganizationV1>[]
): void {
	config.getNetwork.execute.mockResolvedValue(ok(network));
	config.getKnownNodes.executeAll.mockResolvedValue(
		ok({
			count: nodes.length,
			generatedAt: network.time,
			nodes: nodes.map((node) => knownNode(node, 'current-validator', true)),
			scopeTotals: {
				'all-known': nodes.length,
				archived: 0,
				'current-validator': nodes.length,
				listener: 0,
				'public-key-only': 0
			},
			source: 'postgres_canonical'
		})
	);
	config.getKnownOrganizations.executeAll.mockResolvedValue(
		ok({
			count: organizations.length,
			generatedAt: network.time,
			organizations: organizations.map((organization) => ({
				current: true,
				lastMeasurementAt: network.time,
				lastSeen: network.time,
				organization,
				scope: 'current',
				snapshotEndDate: null,
				snapshotStartDate: network.time
			})),
			scopeTotals: {
				'all-known': organizations.length,
				archived: 0,
				current: organizations.length
			},
			source: 'postgres_canonical'
		})
	);
}

function knownNode(
	node: ReturnType<typeof createDummyNodeV1>,
	scope: 'archived' | 'current-validator',
	current: boolean
) {
	return {
		current,
		dateDiscovered: '2020-01-01T00:00:00.000Z',
		lastMeasurementAt: node.dateUpdated,
		lastSeen: node.dateUpdated,
		metadataState: 'snapshot' as const,
		node,
		publicKey: node.publicKey,
		scope,
		snapshotEndDate: current ? null : node.dateUpdated,
		snapshotStartDate: '2020-01-01T00:00:00.000Z'
	};
}

function emptyKnownOrganizations(generatedAt: string) {
	return {
		count: 0,
		generatedAt,
		organizations: [],
		scopeTotals: { 'all-known': 0, archived: 0, current: 0 },
		source: 'postgres_canonical' as const
	};
}
