import type { Index } from 'meilisearch';
import { createDummyNetworkV1 } from '@network-scan/services/__fixtures__/createDummyNetworkV1.js';
import { createDummyNodeV1 } from '@network-scan/services/__fixtures__/createDummyNodeV1.js';
import { buildNetworkSearchSnapshot } from '../NetworkSearchDocumentBuilder.js';
import {
	NetworkSearchService,
	networkSearchStateDocumentId
} from '../NetworkSearchService.js';
import { networkSearchProjectionMaxAgeMs } from '../NetworkSearchProjectionState.js';
import type {
	NetworkSearchIndexStateDocument,
	NetworkSearchInventory,
	NetworkSearchRequest,
	NetworkSearchSnapshot,
	NetworkSearchStoredDocument
} from '../NetworkSearchTypes.js';

describe('NetworkSearchService indexed reads', () => {
	it('serves a recent persisted projection without canonical Postgres reads', async () => {
		const { harness, service, snapshot, state } = setup();

		const result = await service.searchIndexed(request('direct'));

		expect(result).toMatchObject({
			indexedNetworkTime: snapshot.networkTime,
			source: 'meilisearch'
		});
		expect(result?.readModel).toMatchObject({
			canonicalCursor: snapshot.canonicalCursor,
			freshness: 'fresh',
			observedAt: state.indexedAt,
			source: 'meilisearch'
		});
		expect(harness.addDocuments).not.toHaveBeenCalled();
	});

	it('rejects a caller cursor that does not match the indexed generation', async () => {
		const { harness, service, snapshot } = setup();

		await expect(
			service.searchIndexed({
				...request('stale'),
				canonicalCursor: `other-${snapshot.canonicalCursor}`
			})
		).resolves.toBeNull();
		expect(harness.search).not.toHaveBeenCalled();
	});

	it('rejects a projection whose writer heartbeat has expired', async () => {
		const { snapshot } = setup();
		const expiredState = stateFor(
			snapshot,
			new Date(Date.now() - networkSearchProjectionMaxAgeMs - 1).toISOString()
		);
		const expiredHarness = createIndexHarness([
			expiredState,
			...snapshot.documents
		]);
		const service = new NetworkSearchService(
			{ indexName: 'network_test' },
			undefined,
			expiredHarness.index
		);

		await expect(service.searchIndexed(request('too old'))).resolves.toBeNull();
		expect(expiredHarness.search).not.toHaveBeenCalled();
	});

	it('refreshes the writer heartbeat without rewriting entity documents', async () => {
		const { harness, inventory, service } = setup();

		await service.search(inventory, request('heartbeat'));
		await service.refreshProjection(inventory);

		expect(harness.addDocuments).toHaveBeenCalledTimes(1);
		expect(harness.addDocuments.mock.calls[0]?.[0]).toEqual([
			expect.objectContaining({
				documentKind: 'state',
				id: networkSearchStateDocumentId
			})
		]);
		await expect(
			service.searchIndexed(request('heartbeat'))
		).resolves.toMatchObject({ source: 'meilisearch' });
	});
});

function setup() {
	const inventory = createInventory();
	const snapshot = buildNetworkSearchSnapshot(inventory);
	const state = stateFor(snapshot, new Date().toISOString());
	const harness = createIndexHarness([state, ...snapshot.documents]);
	return {
		harness,
		inventory,
		service: new NetworkSearchService(
			{ indexName: 'network_test' },
			undefined,
			harness.index
		),
		snapshot,
		state
	};
}

function request(query: string): NetworkSearchRequest {
	return { limit: 8, offset: 0, query, scope: 'all-known' };
}

function stateFor(
	snapshot: NetworkSearchSnapshot,
	indexedAt: string
): NetworkSearchIndexStateDocument {
	return {
		canonicalArchiveRevision: snapshot.canonicalArchiveRevision,
		canonicalCursor: snapshot.canonicalCursor,
		documentKind: 'state',
		id: networkSearchStateDocumentId,
		indexedAt,
		networkTime: snapshot.networkTime
	};
}

function createInventory(): NetworkSearchInventory {
	const node = createDummyNodeV1('GA_DIRECT_MEILI');
	node.isValidator = true;
	node.name = 'Direct indexed validator';
	const network = createDummyNetworkV1([node], []);
	network.latestLedger = '63390000';
	network.time = '2026-07-19T00:00:00.000Z';
	return {
		archiveRoots: [],
		canonicalArchiveRevision: 'archive-revision',
		generatedAt: '2026-07-19T00:00:01.000Z',
		network,
		nodes: [
			{
				current: true,
				dateDiscovered: '2026-07-01T00:00:00.000Z',
				lastMeasurementAt: node.dateUpdated,
				lastSeen: node.dateUpdated,
				metadataState: 'snapshot',
				node,
				publicKey: node.publicKey,
				scope: 'current-validator',
				snapshotEndDate: null,
				snapshotStartDate: '2026-07-01T00:00:00.000Z'
			}
		],
		organizations: []
	};
}

function createIndexHarness(initial: readonly NetworkSearchStoredDocument[]) {
	let documents = [...initial];
	const successfulTask = () => ({
		waitTask: jest.fn(async () => ({ status: 'succeeded' }))
	});
	const addDocuments = jest.fn(
		(updatedDocuments: NetworkSearchStoredDocument[]) => {
			const replacements = new Map(
				updatedDocuments.map((document) => [document.id, document])
			);
			documents = [
				...documents.filter((document) => !replacements.has(document.id)),
				...updatedDocuments
			];
			return successfulTask();
		}
	);
	const getDocument = jest.fn(async () => {
		const state = documents.find(
			(document) => document.documentKind === 'state'
		);
		if (!state || state.documentKind !== 'state') throw new Error('No state');
		return state;
	});
	const search = jest.fn(async () => {
		const hits = documents.filter(
			(document) => document.documentKind === 'entity'
		);
		return {
			estimatedTotalHits: hits.length,
			facetDistribution: { entityType: { node: hits.length } },
			hits,
			limit: 8,
			offset: 0,
			processingTimeMs: 1,
			query: ''
		};
	});
	return {
		addDocuments,
		index: {
			addDocuments,
			getDocument,
			search
		} as unknown as Index<NetworkSearchStoredDocument>,
		search
	};
}
