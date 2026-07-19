'use server';

import type {
	PublicSearchFacets,
	PublicSearchQueryScope,
	PublicSearchResponse
} from '../../api/search-types';
import { parsePublicSearchResponse } from '../../api/search-response-parser';
import {
	buildNetworkSearchPath,
	type SearchNetworkFilters
} from '../../api/search-request';

export type { SearchNetworkFilters } from '../../api/search-request';

const getInternalApiBaseUrl = (): string => {
	const configuredUrl =
		process.env.STELLAR_ATLAS_INTERNAL_API_URL?.trim() ||
		process.env.STELLAR_ATLAS_PUBLIC_API_URL?.trim() ||
		'http://127.0.0.1:3000';
	return configuredUrl.endsWith('/')
		? configuredUrl.slice(0, -1)
		: configuredUrl;
};

const emptyFacets = (): PublicSearchFacets => ({
	active: [],
	archiveStatus: [],
	countryCode: [],
	entityType: [],
	fullValidator: [],
	scope: [],
	topTier: [],
	validating: [],
	validator: []
});

const emptySearchResponse = (
	query: string,
	scope: PublicSearchQueryScope
): PublicSearchResponse => ({
	estimatedTotalHits: 0,
	facets: emptyFacets(),
	hits: [],
	indexedNetworkTime: null,
	pagination: {
		hasMore: false,
		limit: 8,
		offset: 0,
		total: 0,
		totalIsExact: true
	},
	query,
	readModel: {
		canonicalCursor: null,
		fallbackReason: 'canonical_unavailable',
		freshness: 'unavailable',
		observedAt: null,
		schemaVersion: 'unavailable',
		source: 'unavailable'
	},
	scope,
	source: 'unavailable'
});

export async function searchNetwork(
	query: string,
	filters: SearchNetworkFilters = {}
): Promise<PublicSearchResponse> {
	const normalizedQuery = query.trim();
	const scope = filters.scope ?? 'all-known';
	const url = new URL(
		buildNetworkSearchPath(normalizedQuery, filters),
		getInternalApiBaseUrl()
	);

	try {
		const response = await fetch(url, {
			cache: 'no-store',
			headers: { Accept: 'application/json' }
		});

		if (!response.ok) return emptySearchResponse(normalizedQuery, scope);

		const payload: unknown = await response.json();
		return (
			parsePublicSearchResponse(payload) ??
			emptySearchResponse(normalizedQuery, scope)
		);
	} catch {
		return emptySearchResponse(normalizedQuery, scope);
	}
}
