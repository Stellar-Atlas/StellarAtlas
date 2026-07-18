import type { Index } from 'meilisearch';
import { queryNetworkSearchIndex } from '../NetworkSearchIndexedQuery.js';
import { NetworkSearchService } from '../NetworkSearchService.js';
import type { NetworkSearchCanonicalArchiveSource } from '../NetworkSearchCanonicalArchiveSource.js';
import type {
	NetworkSearchDocument,
	NetworkSearchIndexStateDocument,
	NetworkSearchReadModel,
	NetworkSearchRequest,
	NetworkSearchStoredDocument
} from '../NetworkSearchTypes.js';

describe('network search indexed pagination', () => {
	it('sorts deterministically and derives exact totals from entity facets', async () => {
		const hits = [document('node_b', 'Beta'), document('node_a', 'Alpha')];
		const search = jest.fn(async () => ({
			estimatedTotalHits: 99,
			facetDistribution: {
				entityType: { node: 2, organization: 1 },
				scope: { 'current-validator': 3 }
			},
			hits,
			limit: 2,
			offset: 0,
			processingTimeMs: 1,
			query: ''
		}));
		const index = { search } as unknown as Index<NetworkSearchStoredDocument>;

		const response = await queryNetworkSearchIndex(
			index,
			state('cursor-a'),
			{ ...request(), limit: 2 },
			indexedReadModel('cursor-a')
		);

		expect(search).toHaveBeenCalledWith(
			'',
			expect.objectContaining({ sort: ['label:asc', 'id:asc'] })
		);
		expect(response.pagination).toEqual({
			hasMore: true,
			limit: 2,
			offset: 0,
			total: 3,
			totalIsExact: true
		});
		expect(response.facets.entityType).toEqual([
			{ count: 2, value: 'node' },
			{ count: 1, value: 'organization' }
		]);
	});

	it('keeps inexact pages traversable when an estimate undercounts hits', async () => {
		const hits = [document('node_a', 'Alpha'), document('node_b', 'Beta')];
		const index = {
			search: jest.fn(async () => ({
				estimatedTotalHits: 1,
				hits,
				limit: 2,
				offset: 4,
				processingTimeMs: 1,
				query: ''
			}))
		} as unknown as Index<NetworkSearchStoredDocument>;

		const response = await queryNetworkSearchIndex(
			index,
			state('cursor-a'),
			{ ...request(), limit: 2, offset: 4 },
			indexedReadModel('cursor-a')
		);

		expect(response.pagination).toEqual({
			hasMore: true,
			limit: 2,
			offset: 4,
			total: 6,
			totalIsExact: false
		});
	});

	it('retries once against a new stable generation', async () => {
		const initial = state('cursor-a');
		const replacement = state('cursor-b');
		const getDocument = jest
			.fn()
			.mockResolvedValueOnce(initial)
			.mockResolvedValueOnce(replacement)
			.mockResolvedValueOnce(replacement);
		const search = jest.fn(async () => ({
			estimatedTotalHits: 1,
			facetDistribution: { entityType: { node: 1 } },
			hits: [document('node_a', 'Alpha')],
			limit: 8,
			offset: 0,
			processingTimeMs: 1,
			query: ''
		}));
		const index = {
			getDocument,
			search
		} as unknown as Index<NetworkSearchStoredDocument>;
		const service = new NetworkSearchService(
			{ indexName: 'network-pagination-test', writable: false },
			undefined,
			index,
			undefined,
			canonicalArchiveSource()
		);

		const response = await service.searchIndexed(
			request(),
			new Date(initial.networkTime)
		);

		expect(search).toHaveBeenCalledTimes(2);
		expect(search.mock.calls[0]?.[1]).toEqual(
			expect.objectContaining({
				filter: expect.stringContaining('cursor-a')
			})
		);
		expect(search.mock.calls[1]?.[1]).toEqual(
			expect.objectContaining({
				filter: expect.stringContaining('cursor-b')
			})
		);
		expect(response?.readModel.canonicalCursor).toBe('cursor-b');
	});

	it('rejects an archive-only canonical revision change', async () => {
		const currentState = state('cursor-a');
		const search = jest.fn();
		const index = {
			getDocument: jest.fn(async () => currentState),
			search
		} as unknown as Index<NetworkSearchStoredDocument>;
		const source: NetworkSearchCanonicalArchiveSource = {
			load: jest.fn(async () => ({ revision: 'archive-b', roots: [] }))
		};
		const service = new NetworkSearchService(
			{ indexName: 'network-pagination-test', writable: false },
			undefined,
			index,
			undefined,
			source
		);

		await expect(
			service.searchIndexed(request(), new Date(currentState.networkTime))
		).resolves.toBeNull();
		expect(search).not.toHaveBeenCalled();
	});
});

function request(): NetworkSearchRequest {
	return { limit: 8, offset: 0, query: '', scope: 'all-known' };
}

function state(canonicalCursor: string): NetworkSearchIndexStateDocument {
	return {
		canonicalArchiveRevision: 'archive-a',
		canonicalCursor,
		documentKind: 'state',
		id: 'network_search_state',
		indexedAt: '2026-07-18T00:00:01.000Z',
		networkTime: '2026-07-18T00:00:00.000Z'
	};
}

function indexedReadModel(canonicalCursor: string): NetworkSearchReadModel {
	return {
		canonicalCursor,
		fallbackReason: null,
		freshness: 'fresh',
		observedAt: '2026-07-18T00:00:01.000Z',
		schemaVersion: 'test',
		source: 'meilisearch'
	};
}

function canonicalArchiveSource(): NetworkSearchCanonicalArchiveSource {
	return {
		load: jest.fn(async () => ({ revision: 'archive-a', roots: [] }))
	};
}

function document(id: string, label: string): NetworkSearchDocument {
	return {
		canonicalCursor: 'cursor-a',
		content: label,
		detail: label,
		documentKind: 'entity',
		entityId: id,
		entityType: 'node',
		href: `/nodes/${id}`,
		id,
		indexedAt: '2026-07-18T00:00:01.000Z',
		label,
		latestLedger: '64000000',
		networkTime: '2026-07-18T00:00:00.000Z',
		observedAt: '2026-07-18T00:00:00.000Z',
		recordState: 'current',
		scope: 'current-validator'
	};
}
