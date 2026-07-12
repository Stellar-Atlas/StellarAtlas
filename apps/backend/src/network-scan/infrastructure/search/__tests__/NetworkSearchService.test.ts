import type { Index } from 'meilisearch';
import {
	NetworkSearchService,
	networkSearchStateDocumentId
} from '../NetworkSearchService.js';
import { buildNetworkSearchSnapshot } from '../NetworkSearchDocumentBuilder.js';
import { networkSearchRequiredSettings } from '../NetworkSearchQuery.js';
import type {
	NetworkSearchIndexStateDocument,
	NetworkSearchInventory,
	NetworkSearchRequest,
	NetworkSearchStoredDocument
} from '../NetworkSearchTypes.js';
import { createDummyNetworkV1 } from '@network-scan/services/__fixtures__/createDummyNetworkV1.js';
import { createDummyNodeV1 } from '@network-scan/services/__fixtures__/createDummyNodeV1.js';
import { createDummyOrganizationV1 } from '@network-scan/services/__fixtures__/createDummyOrganizationV1.js';

describe('NetworkSearchService', () => {
	it('searches current, archived, and public-key-only canonical records', async () => {
		const organization = createDummyOrganizationV1();
		organization.id = 'sdf';
		organization.name = 'Stellar Development Foundation';
		organization.homeDomain = 'stellar.org';
		const current = createDummyNodeV1('GA_CURRENT_SEARCH');
		current.name = 'SDF Validator 1';
		current.organizationId = organization.id;
		const archived = createDummyNodeV1('GA_ARCHIVED_SEARCH');
		archived.name = 'Historic SDF validator';
		const inventory = createInventory(
			[currentNode(current), archivedNode(archived), publicKeyOnlyNode()],
			[currentOrganization(organization)]
		);
		const service = new NetworkSearchService({ indexName: 'network_test' });

		const result = await service.search(inventory, request('sdf'));

		expect(result.source).toBe('postgres_canonical');
		expect(result.readModel).toMatchObject({
			fallbackReason: 'meilisearch_unconfigured',
			freshness: 'fresh',
			source: 'postgres_canonical'
		});
		expect(result.hits.map((hit) => hit.entityId)).toEqual(
			expect.arrayContaining([
				organization.id,
				current.publicKey,
				archived.publicKey
			])
		);
		expect(
			result.hits.find((hit) => hit.entityId === archived.publicKey)
		).toMatchObject({
			freshness: 'fresh',
			recordState: 'historical',
			scope: 'archived'
		});
	});

	it('filters explicit inventory scopes with exact canonical pagination', async () => {
		const first = createDummyNodeV1('GA_LISTENER_A');
		const second = createDummyNodeV1('GA_LISTENER_B');
		first.name = 'Listener alpha';
		second.name = 'Listener beta';
		const inventory = createInventory(
			[currentNode(first, 'listener'), currentNode(second, 'listener')],
			[]
		);
		const service = new NetworkSearchService({ indexName: 'network_test' });

		const result = await service.search(inventory, {
			...request('listener'),
			limit: 1,
			offset: 1,
			scope: 'listener'
		});

		expect(result.pagination).toEqual({
			hasMore: false,
			limit: 1,
			offset: 1,
			total: 2,
			totalIsExact: true
		});
		expect(result.hits).toHaveLength(1);
		expect(result.facets.scope).toEqual([{ count: 2, value: 'listener' }]);
	});

	it('searches canonical archive evidence with explicit provenance', async () => {
		const baseInventory = createInventory([], []);
		const inventory: NetworkSearchInventory = {
			...baseInventory,
			archiveRoots: [
				{
					archiveUrl: 'https://history.example.org',
					archiveUrlIdentity: 'https://history.example.org',
					checkpoints: {
						mismatchedCheckpoints: 0,
						notEvaluableCheckpoints: 0,
						pendingCheckpoints: 2,
						totalCheckpoints: 4,
						verifiedCheckpoints: 2
					},
					latestObjectAt: '2026-07-11T00:00:00.000Z',
					nodePublicKeys: ['GA_ARCHIVE'],
					objects: {
						activeObjects: 1,
						bucketObjects: 3,
						pendingObjects: 2,
						remoteFailureObjects: 1,
						totalObjects: 8,
						verifiedBucketObjects: 2,
						verifiedObjects: 5,
						workerIssueObjects: 0
					},
					scannerOwnedState: null
				}
			]
		};
		const result = await new NetworkSearchService({
			indexName: 'network_test'
		}).search(inventory, {
			...request('history.example.org'),
			entityType: 'archive-root'
		});

		expect(result.source).toBe('postgres_canonical');
		expect(result.hits).toEqual([
			expect.objectContaining({
				entityType: 'archive-root',
				evidenceFailures: 1,
				evidenceProvenance: 'postgres_canonical',
				evidenceVerified: 5
			})
		]);
	});

	it('uses a synchronized Meilisearch projection with matching cursor', async () => {
		const node = createDummyNodeV1('GA_MEILI_CURRENT');
		node.name = 'Indexed validator';
		const inventory = createInventory([currentNode(node)], []);
		const harness = createIndexHarness();
		const service = new NetworkSearchService(
			{ indexName: 'network_test' },
			undefined,
			harness.index
		);

		await service.search(inventory, request('indexed'));
		await harness.waitForSync();
		const result = await service.search(inventory, request('indexed'));

		expect(result.source).toBe('meilisearch');
		expect(result.readModel).toMatchObject({
			fallbackReason: null,
			freshness: 'fresh',
			source: 'meilisearch'
		});
		expect(result.hits[0]).toMatchObject({
			entityId: node.publicKey,
			freshness: 'fresh',
			recordState: 'current',
			scope: 'current-validator',
			source: 'meilisearch'
		});
	});

	it('reuses an already synchronized projection without rewriting it', async () => {
		const node = createDummyNodeV1('GA_PRELOADED_MEILI');
		node.name = 'Preloaded validator';
		const inventory = createInventory([currentNode(node)], []);
		const snapshot = buildNetworkSearchSnapshot(inventory);
		const state: NetworkSearchIndexStateDocument = {
			canonicalCursor: snapshot.canonicalCursor,
			documentKind: 'state',
			id: networkSearchStateDocumentId,
			indexedAt: '2026-07-11T00:00:02.000Z',
			networkTime: snapshot.networkTime
		};
		const harness = createIndexHarness({
			initialDocuments: [state, ...snapshot.documents]
		});
		const service = new NetworkSearchService(
			{ indexName: 'network_test' },
			undefined,
			harness.index
		);

		const result = await service.search(inventory, request('preloaded'));

		expect(result.source).toBe('meilisearch');
		expect(harness.addDocuments).not.toHaveBeenCalled();
	});

	it('serves a persisted projection without rebuilding canonical inventory', async () => {
		const node = createDummyNodeV1('GA_DIRECT_MEILI');
		node.name = 'Direct indexed validator';
		const inventory = createInventory([currentNode(node)], []);
		const snapshot = buildNetworkSearchSnapshot(inventory);
		const state: NetworkSearchIndexStateDocument = {
			canonicalCursor: snapshot.canonicalCursor,
			documentKind: 'state',
			id: networkSearchStateDocumentId,
			indexedAt: '2026-07-11T00:00:02.000Z',
			networkTime: snapshot.networkTime
		};
		const harness = createIndexHarness({
			initialDocuments: [state, ...snapshot.documents]
		});
		const service = new NetworkSearchService(
			{ indexName: 'network_test' },
			undefined,
			harness.index
		);

		const result = await service.searchIndexed(
			request('direct'),
			new Date(snapshot.networkTime)
		);

		expect(result).toMatchObject({
			indexedNetworkTime: snapshot.networkTime,
			source: 'meilisearch'
		});
		expect(result?.readModel).toMatchObject({
			canonicalCursor: snapshot.canonicalCursor,
			observedAt: state.indexedAt,
			source: 'meilisearch'
		});
		expect(harness.addDocuments).not.toHaveBeenCalled();
	});

	it('serves a bounded lagging projection as explicitly stale', async () => {
		const inventory = createInventory(
			[currentNode(createDummyNodeV1('GA'))],
			[]
		);
		const snapshot = buildNetworkSearchSnapshot(inventory);
		const state: NetworkSearchIndexStateDocument = {
			canonicalCursor: snapshot.canonicalCursor,
			documentKind: 'state',
			id: networkSearchStateDocumentId,
			indexedAt: '2026-07-11T00:00:02.000Z',
			networkTime: snapshot.networkTime
		};
		const harness = createIndexHarness({
			initialDocuments: [state, ...snapshot.documents]
		});
		const service = new NetworkSearchService(
			{ indexName: 'network_test' },
			undefined,
			harness.index
		);

		await expect(
			service.searchIndexed(
				request('stale'),
				new Date(Date.parse(snapshot.networkTime) + 60_000)
			)
		).resolves.toMatchObject({
			hits: [expect.objectContaining({ freshness: 'stale' })],
			readModel: {
				fallbackReason: 'meilisearch_stale',
				freshness: 'stale',
				source: 'meilisearch'
			},
			source: 'meilisearch'
		});
	});

	it('rejects a projection beyond the bounded network-time lag', async () => {
		const inventory = createInventory(
			[currentNode(createDummyNodeV1('GA_TOO_OLD'))],
			[]
		);
		const snapshot = buildNetworkSearchSnapshot(inventory);
		const state: NetworkSearchIndexStateDocument = {
			canonicalCursor: snapshot.canonicalCursor,
			documentKind: 'state',
			id: networkSearchStateDocumentId,
			indexedAt: '2026-07-11T00:00:02.000Z',
			networkTime: snapshot.networkTime
		};
		const harness = createIndexHarness({ initialDocuments: [state] });
		const service = new NetworkSearchService(
			{ indexName: 'network_test' },
			undefined,
			harness.index
		);

		await expect(
			service.searchIndexed(
				request('too old'),
				new Date(Date.parse(snapshot.networkTime) + 16 * 60_000)
			)
		).resolves.toBeNull();
	});

	it('does not enqueue projection writes from a read-only API worker', async () => {
		const inventory = createInventory(
			[currentNode(createDummyNodeV1('GA_READ_ONLY'))],
			[]
		);
		const harness = createIndexHarness();
		const service = new NetworkSearchService(
			{ indexName: 'network_test', writable: false },
			undefined,
			harness.index
		);

		const result = await service.search(inventory, request('read only'));

		expect(result.source).toBe('postgres_canonical');
		expect(harness.addDocuments).not.toHaveBeenCalled();
	});

	it('rejects a stale or newer conflicting Meilisearch cursor', async () => {
		const node = createDummyNodeV1('GA_CANONICAL_NODE');
		node.name = 'Canonical validator';
		const inventory = createInventory([currentNode(node)], []);
		const harness = createIndexHarness();
		const service = new NetworkSearchService(
			{ indexName: 'network_test' },
			undefined,
			harness.index
		);

		await service.search(inventory, request('canonical'));
		await harness.waitForSync();
		const currentState = harness.state();
		harness.getDocument.mockResolvedValueOnce({
			...currentState,
			canonicalCursor: `newer-${currentState.canonicalCursor}`
		});
		const result = await service.search(inventory, request('canonical'));

		expect(result.source).toBe('postgres_canonical');
		expect(result.readModel).toMatchObject({
			fallbackReason: 'meilisearch_stale',
			source: 'postgres_canonical'
		});
		expect(result.hits.map((hit) => hit.entityId)).toEqual([node.publicKey]);
		expect(harness.search).not.toHaveBeenCalled();
		await harness.waitForSync();
	});

	it('keeps canonical results when Meilisearch synchronization fails', async () => {
		const node = createDummyNodeV1('GA_UNAVAILABLE_MEILI');
		node.name = 'Fallback validator';
		const inventory = createInventory([currentNode(node)], []);
		const harness = createIndexHarness({ failSettings: true });
		const service = new NetworkSearchService(
			{ indexName: 'network_test' },
			undefined,
			harness.index
		);

		const first = await service.search(inventory, request('fallback'));
		expect(first.readModel.fallbackReason).toBe('meilisearch_syncing');
		await harness.waitForSyncFailure();
		const retry = await service.search(inventory, request('fallback'));

		expect(retry.source).toBe('postgres_canonical');
		expect(retry.readModel.fallbackReason).toBe('meilisearch_unavailable');
		expect(retry.hits.map((hit) => hit.entityId)).toEqual([node.publicKey]);
	});
});

function request(query: string): NetworkSearchRequest {
	return { limit: 8, offset: 0, query, scope: 'all-known' };
}

function createInventory(
	nodes: NetworkSearchInventory['nodes'],
	organizations: NetworkSearchInventory['organizations']
): NetworkSearchInventory {
	const network = createDummyNetworkV1(
		nodes.flatMap((node) => (node.current && node.node ? [node.node] : [])),
		organizations.flatMap((organization) =>
			organization.current ? [organization.organization] : []
		)
	);
	network.time = '2026-07-11T00:00:00.000Z';
	network.latestLedger = '63390000';
	return {
		archiveRoots: [],
		generatedAt: '2026-07-11T00:00:01.000Z',
		network,
		nodes,
		organizations
	};
}

function currentNode(
	node: ReturnType<typeof createDummyNodeV1>,
	scope: 'current-validator' | 'listener' = 'current-validator'
): NetworkSearchInventory['nodes'][number] {
	node.isValidator = scope === 'current-validator';
	return {
		current: true,
		dateDiscovered: '2026-07-01T00:00:00.000Z',
		lastMeasurementAt: node.dateUpdated,
		lastSeen: node.dateUpdated,
		metadataState: 'snapshot',
		node,
		publicKey: node.publicKey,
		scope,
		snapshotEndDate: null,
		snapshotStartDate: '2026-07-01T00:00:00.000Z'
	};
}

function archivedNode(
	node: ReturnType<typeof createDummyNodeV1>
): NetworkSearchInventory['nodes'][number] {
	return {
		...currentNode(node),
		current: false,
		scope: 'archived',
		snapshotEndDate: '2026-07-10T00:00:00.000Z'
	};
}

function publicKeyOnlyNode(): NetworkSearchInventory['nodes'][number] {
	return {
		current: false,
		dateDiscovered: '2026-07-01T00:00:00.000Z',
		lastMeasurementAt: null,
		lastSeen: '2026-07-10T00:00:00.000Z',
		metadataState: 'public_key_only',
		node: null,
		publicKey: 'GA_PUBLIC_KEY_ONLY',
		scope: 'public-key-only',
		snapshotEndDate: null,
		snapshotStartDate: null
	};
}

function currentOrganization(
	organization: ReturnType<typeof createDummyOrganizationV1>
): NetworkSearchInventory['organizations'][number] {
	return {
		current: true,
		lastMeasurementAt: '2026-07-11T00:00:00.000Z',
		lastSeen: '2026-07-11T00:00:00.000Z',
		organization,
		scope: 'current',
		snapshotEndDate: null,
		snapshotStartDate: '2026-07-01T00:00:00.000Z'
	};
}

function createIndexHarness(
	options: {
		failSettings?: boolean;
		initialDocuments?: readonly NetworkSearchStoredDocument[];
	} = {}
) {
	let storedDocuments: NetworkSearchStoredDocument[] = [
		...(options.initialDocuments ?? [])
	];
	const successfulTask = () => ({
		waitTask: jest.fn(async () => ({ status: 'succeeded' }))
	});
	const getSettings = options.failSettings
		? jest.fn(async () => {
				throw new Error('Meilisearch unavailable');
			})
		: jest.fn(async () => ({
				filterableAttributes: [
					...(networkSearchRequiredSettings.filterableAttributes ?? [])
				],
				searchableAttributes: [
					...(networkSearchRequiredSettings.searchableAttributes ?? [])
				],
				sortableAttributes: [
					...(networkSearchRequiredSettings.sortableAttributes ?? [])
				]
			}));
	const addDocuments = jest.fn((documents: NetworkSearchStoredDocument[]) => {
		storedDocuments = documents;
		return successfulTask();
	});
	const deleteDocuments = jest.fn(() => successfulTask());
	const getDocument = jest.fn(async () => state());
	const search = jest.fn(async () => {
		const hits = storedDocuments.filter(
			(document) => document.documentKind === 'entity'
		);
		return {
			estimatedTotalHits: hits.length,
			facetDistribution: {},
			hits,
			limit: 8,
			offset: 0,
			processingTimeMs: 1,
			query: ''
		};
	});
	const state = (): NetworkSearchIndexStateDocument => {
		const value = storedDocuments.find(
			(document) => document.documentKind === 'state'
		);
		if (!value || value.documentKind !== 'state') {
			throw new Error('Search index state was not written');
		}
		return value;
	};
	const index = {
		addDocuments,
		deleteDocuments,
		getDocument,
		getSettings,
		search,
		updateSettings: jest.fn(() =>
			options.failSettings
				? {
						waitTask: jest.fn(async () => {
							throw new Error('Meilisearch unavailable');
						})
					}
				: successfulTask()
		)
	} as unknown as Index<NetworkSearchStoredDocument>;

	return {
		addDocuments,
		getDocument,
		index,
		search,
		state,
		waitForSync: () => waitUntil(() => deleteDocuments.mock.calls.length > 0),
		waitForSyncFailure: () =>
			waitUntil(
				() =>
					getSettings.mock.calls.length > 0 &&
					addDocuments.mock.calls.length === 0
			)
	};
}

async function waitUntil(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (condition()) {
			await new Promise<void>((resolve) => setImmediate(resolve));
			return;
		}
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	throw new Error('Search index synchronization did not settle');
}
