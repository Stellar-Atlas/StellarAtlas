import express from 'express';
import request from 'supertest';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import { networkRouter } from '../NetworkRouter.js';
import type { NetworkRouterConfig } from '../NetworkRouter.js';
import { createDummyNetworkV1 } from '@network-scan/services/__fixtures__/createDummyNetworkV1.js';
import { createDummyNodeV1 } from '@network-scan/services/__fixtures__/createDummyNodeV1.js';
import { createDummyOrganizationV1 } from '@network-scan/services/__fixtures__/createDummyOrganizationV1.js';
import { NetworkSearchService } from '../../search/NetworkSearchService.js';
import { networkSearchProjectionRefreshIntervalMs } from '../../search/NetworkSearchProjectionRefresher.js';
import type { NetworkSearchResponse } from '../../search/NetworkSearchTypes.js';

describe('NetworkRouter.integration', () => {
	afterEach(() => {
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	it('should expose current network snapshots with frontend-aligned cache age', async () => {
		const config = mockDeep<NetworkRouterConfig>();
		config.searchConfig = { indexName: 'test_network_entities' };
		const network = createDummyNetworkV1();
		network.name = 'Public Stellar Network';
		config.getNetwork.execute.mockResolvedValue(ok(network));
		const app = express();
		app.use('/network', networkRouter(config));

		await request(app)
			.get('/network')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body.name).toBe('Public Stellar Network');
				expect(response.body.scope).toBe('current-network');
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

	it('returns a valid indexed search payload from a read-only API worker', async () => {
		const indexedNetworkTime = '2026-07-11T00:00:00.000Z';
		const indexedPayload: NetworkSearchResponse = {
			estimatedTotalHits: 1,
			facets: {
				active: [],
				archiveStatus: [],
				countryCode: [],
				entityType: [{ count: 1, value: 'node' }],
				fullValidator: [],
				scope: [{ count: 1, value: 'current-validator' }],
				topTier: [],
				validating: [],
				validator: []
			},
			hits: [
				{
					detail: 'stellar.org',
					entityId: 'GA_READ_ONLY_INDEXED',
					entityType: 'node',
					freshness: 'fresh',
					href: '/nodes/GA_READ_ONLY_INDEXED',
					id: 'node:GA_READ_ONLY_INDEXED',
					label: 'Read-only indexed validator',
					observedAt: indexedNetworkTime,
					recordState: 'current',
					scope: 'current-validator',
					source: 'meilisearch'
				}
			],
			indexedNetworkTime,
			pagination: {
				hasMore: false,
				limit: 8,
				offset: 0,
				total: 1,
				totalIsExact: false
			},
			query: 'indexed',
			readModel: {
				canonicalCursor: 'indexed-cursor',
				fallbackReason: null,
				freshness: 'fresh',
				observedAt: indexedNetworkTime,
				schemaVersion: 'v1',
				source: 'meilisearch'
			},
			scope: 'all-known',
			source: 'meilisearch'
		};
		const searchIndexed = jest
			.spyOn(NetworkSearchService.prototype, 'searchIndexed')
			.mockResolvedValue(indexedPayload);
		const refreshProjection = jest.spyOn(
			NetworkSearchService.prototype,
			'refreshProjection'
		);
		const fallbackNode = createDummyNodeV1('GA_CANONICAL_FALLBACK');
		const config = mockDeep<NetworkRouterConfig>();
		config.searchConfig = {
			indexName: 'test_network_entities',
			writable: false
		};
		configureSearchInventory(
			config,
			createDummyNetworkV1([fallbackNode], []),
			[fallbackNode],
			[]
		);

		const app = express();
		app.use('/network', networkRouter(config));

		await request(app)
			.get('/network/search?q=indexed')
			.expect(200)
			.expect((response) => {
				expect(response.body).toEqual(indexedPayload);
			});

		expect(searchIndexed).toHaveBeenCalledWith(
			expect.objectContaining({ query: 'indexed' })
		);
		expect(
			config.networkScanRepository.findLatestSuccessfulScanTime
		).not.toHaveBeenCalled();
		expect(config.getNetwork.execute).not.toHaveBeenCalled();
		expect(config.getKnownNodes.executeAll).not.toHaveBeenCalled();
		expect(refreshProjection).not.toHaveBeenCalled();
	});

	it('autonomously refreshes projection only on the designated API writer', async () => {
		jest.useFakeTimers();
		const refreshProjection = jest
			.spyOn(NetworkSearchService.prototype, 'refreshProjection')
			.mockImplementation(() => undefined);
		const network = createDummyNetworkV1([], []);
		const writerConfig = mockDeep<NetworkRouterConfig>();
		writerConfig.searchConfig = {
			host: 'http://127.0.0.1:7701',
			indexName: 'test_network_entities',
			writable: true
		};
		configureSearchInventory(writerConfig, network, [], []);
		const readerConfig = mockDeep<NetworkRouterConfig>();
		readerConfig.searchConfig = {
			host: 'http://127.0.0.1:7701',
			indexName: 'test_network_entities',
			writable: false
		};
		configureSearchInventory(readerConfig, network, [], []);

		const writerRouter = networkRouter(writerConfig);
		const readerRouter = networkRouter(readerConfig);
		await jest.advanceTimersByTimeAsync(0);

		expect(writerConfig.getNetwork.execute).toHaveBeenCalledTimes(1);
		expect(refreshProjection).toHaveBeenCalledTimes(1);
		expect(readerConfig.getNetwork.execute).not.toHaveBeenCalled();

		writerRouter.stopNetworkSearchProjection();
		readerRouter.stopNetworkSearchProjection();
		await jest.advanceTimersByTimeAsync(
			networkSearchProjectionRefreshIntervalMs * 2
		);
		expect(writerConfig.getNetwork.execute).toHaveBeenCalledTimes(1);
		expect(refreshProjection).toHaveBeenCalledTimes(1);
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

	it('filters current organizations by the scope emitted by the index', async () => {
		const organization = createDummyOrganizationV1();
		organization.id = 'current-org';
		organization.name = 'Current Organization';

		const config = mockDeep<NetworkRouterConfig>();
		config.searchConfig = { indexName: 'test_network_entities' };
		configureSearchInventory(
			config,
			createDummyNetworkV1([], [organization]),
			[],
			[organization]
		);

		const app = express();
		app.use('/network', networkRouter(config));

		await request(app)
			.get('/network/search/organizations?q=current&scope=current-organization')
			.expect(200)
			.expect((response) => {
				expect(response.body.scope).toBe('current-organization');
				expect(response.body.hits).toHaveLength(1);
				expect(response.body.hits[0]).toMatchObject({
					entityId: 'current-org',
					entityType: 'organization',
					scope: 'current-organization'
				});
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
		config.getKnownArchiveEvidence.execute.mockResolvedValue(
			ok({ roots: [] } as never)
		);
		setCanonicalArchiveSource(config);

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
	setCanonicalArchiveSource(config);
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
	config.getKnownArchiveEvidence.execute.mockResolvedValue(
		ok({ roots: [] } as never)
	);
}

function setCanonicalArchiveSource(
	config: DeepMockProxy<NetworkRouterConfig>
): void {
	Object.assign(config, {
		networkSearchCanonicalArchiveSource: {
			load: jest.fn().mockResolvedValue({
				revision: 'test-canonical-archive-revision',
				roots: []
			})
		}
	});
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
