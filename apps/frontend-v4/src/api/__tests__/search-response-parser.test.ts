/// <reference types="jest" />

import { parsePublicSearchResponse } from '../search-response-parser';

describe('search response parser', () => {
	it('accepts a bounded stale Meilisearch projection without calling it fresh', () => {
		const parsed = parsePublicSearchResponse({
			estimatedTotalHits: 1,
			facets: emptyFacets(),
			hits: [
				{
					detail: 'Indexed validator',
					entityId: 'GA_STALE',
					entityType: 'node',
					freshness: 'stale',
					href: '/nodes/GA_STALE',
					id: 'node_GA_STALE',
					label: 'Indexed validator',
					observedAt: '2026-07-11T00:00:00.000Z',
					recordState: 'current',
					scope: 'current-validator',
					source: 'meilisearch'
				}
			],
			indexedNetworkTime: '2026-07-11T00:00:00.000Z',
			pagination: {
				hasMore: false,
				limit: 8,
				offset: 0,
				total: 1,
				totalIsExact: false
			},
			query: 'indexed',
			readModel: {
				canonicalCursor: 'stale-cursor',
				fallbackReason: 'meilisearch_stale',
				freshness: 'stale',
				observedAt: '2026-07-11T00:00:01.000Z',
				schemaVersion: 'v3',
				source: 'meilisearch'
			},
			scope: 'all-known',
			source: 'meilisearch'
		});

		expect(parsed).toMatchObject({
			hits: [{ freshness: 'stale' }],
			readModel: { freshness: 'stale' },
			source: 'meilisearch'
		});
	});

	it('retains canonical stale-index fallback and per-hit source metadata', () => {
		const parsed = parsePublicSearchResponse({
			estimatedTotalHits: 1,
			facets: emptyFacets(),
			hits: [
				{
					detail: 'Public key observed without a retained node snapshot',
					entityId: 'GA_PUBLIC_KEY_ONLY',
					entityType: 'node',
					freshness: 'fresh',
					href: '/nodes/GA_PUBLIC_KEY_ONLY',
					id: 'node_GA_PUBLIC_KEY_ONLY',
					label: 'GA_PUBLIC_KEY_ONLY',
					observedAt: '2026-07-11T00:00:00.000Z',
					recordState: 'identity-only',
					scope: 'public-key-only',
					source: 'postgres_canonical'
				}
			],
			indexedNetworkTime: '2026-07-11T00:00:00.000Z',
			pagination: {
				hasMore: false,
				limit: 8,
				offset: 0,
				total: 1,
				totalIsExact: true
			},
			query: 'GA_PUBLIC',
			readModel: {
				canonicalCursor: 'canonical-cursor',
				fallbackReason: 'meilisearch_stale',
				freshness: 'fresh',
				observedAt: '2026-07-11T00:00:01.000Z',
				schemaVersion: 'v1',
				source: 'postgres_canonical'
			},
			scope: 'all-known',
			source: 'postgres_canonical'
		});

		expect(parsed).toMatchObject({
			pagination: { total: 1, totalIsExact: true },
			readModel: {
				fallbackReason: 'meilisearch_stale',
				source: 'postgres_canonical'
			},
			scope: 'all-known',
			source: 'postgres_canonical'
		});
		expect(parsed?.hits[0]).toMatchObject({
			freshness: 'fresh',
			recordState: 'identity-only',
			scope: 'public-key-only',
			source: 'postgres_canonical'
		});
	});

	it('rejects unchecked or contradictory source contracts', () => {
		expect(
			parsePublicSearchResponse({
				estimatedTotalHits: 0,
				facets: emptyFacets(),
				hits: [],
				indexedNetworkTime: '2026-07-11T00:00:00.000Z',
				pagination: {
					hasMore: false,
					limit: 8,
					offset: 0,
					total: 0,
					totalIsExact: true
				},
				query: '',
				readModel: {
					canonicalCursor: 'cursor',
					fallbackReason: null,
					freshness: 'fresh',
					observedAt: '2026-07-11T00:00:00.000Z',
					schemaVersion: 'v1',
					source: 'unknown'
				},
				scope: 'all-known',
				source: 'unknown'
			})
		).toBeNull();
	});

	it('accepts archive-root evidence provenance', () => {
		const response = {
			estimatedTotalHits: 1,
			facets: emptyFacets(),
			hits: [
				{
					detail: '5 verified file checks; 1 remote failures',
					entityId: 'https://history.example.org',
					entityType: 'archive-root',
					evidenceFailures: 1,
					evidenceProvenance: 'postgres_canonical',
					evidenceVerified: 5,
					freshness: 'fresh',
					href: '/archive-scans/example',
					id: 'archive_example',
					label: 'history.example.org',
					observedAt: '2026-07-11T00:00:00.000Z',
					recordState: 'current',
					scope: 'archive-root',
					source: 'postgres_canonical'
				}
			],
			indexedNetworkTime: '2026-07-11T00:00:00.000Z',
			pagination: {
				hasMore: false,
				limit: 8,
				offset: 0,
				total: 1,
				totalIsExact: true
			},
			query: 'history',
			readModel: {
				canonicalCursor: 'cursor',
				fallbackReason: 'meilisearch_unconfigured',
				freshness: 'fresh',
				observedAt: '2026-07-11T00:00:00.000Z',
				schemaVersion: 'v2',
				source: 'postgres_canonical'
			},
			scope: 'all-known',
			source: 'postgres_canonical'
		};
		expect(parsePublicSearchResponse(response)?.hits[0]).toMatchObject({
			entityType: 'archive-root',
			evidenceProvenance: 'postgres_canonical'
		});
	});

	it.each(['current-organization', 'archive-root'] as const)(
		'accepts %s as an explicit search response scope',
		(scope) => {
			const parsed = parsePublicSearchResponse({
				estimatedTotalHits: 0,
				facets: emptyFacets(),
				hits: [],
				indexedNetworkTime: '2026-07-11T00:00:00.000Z',
				pagination: {
					hasMore: false,
					limit: 8,
					offset: 0,
					total: 0,
					totalIsExact: true
				},
				query: '',
				readModel: {
					canonicalCursor: 'cursor',
					fallbackReason: null,
					freshness: 'fresh',
					observedAt: '2026-07-11T00:00:00.000Z',
					schemaVersion: 'v1',
					source: 'meilisearch'
				},
				scope,
				source: 'meilisearch'
			});

			expect(parsed?.scope).toBe(scope);
		}
	);
});

function emptyFacets() {
	return {
		active: [],
		archiveStatus: [],
		countryCode: [],
		entityType: [],
		fullValidator: [],
		scope: [],
		topTier: [],
		validating: [],
		validator: []
	};
}
