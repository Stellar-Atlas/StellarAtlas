'use server';

import type {
	PublicSearchArchiveStatus,
	PublicSearchEntityType,
	PublicSearchFacetName,
	PublicSearchFacets,
	PublicSearchResponse
} from '../../api/types';

export interface SearchNetworkFilters {
	active?: boolean;
	archiveStatus?: PublicSearchArchiveStatus;
	countryCode?: string;
	entityType?: PublicSearchEntityType;
	fullValidator?: boolean;
	topTier?: boolean;
	validating?: boolean;
	validator?: boolean;
}

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
	topTier: [],
	validating: [],
	validator: []
});

const emptySearchResponse = (query: string): PublicSearchResponse => ({
	estimatedTotalHits: 0,
	facets: emptyFacets(),
	hits: [],
	indexedNetworkTime: new Date(0).toISOString(),
	query,
	readModel: {
		fallbackReason: 'meilisearch_unavailable',
		schemaVersion: 'v1'
	},
	source: 'memory'
});

const setBooleanFilter = (
	url: URL,
	name: PublicSearchFacetName,
	value: boolean | undefined
): void => {
	if (value === undefined) return;
	url.searchParams.set(name, value ? 'true' : 'false');
};

export async function searchNetwork(
	query: string,
	filters: SearchNetworkFilters = {}
): Promise<PublicSearchResponse> {
	const normalizedQuery = query.trim();
	const url = new URL('/v1/search', getInternalApiBaseUrl());
	url.searchParams.set('q', normalizedQuery);
	url.searchParams.set('limit', '8');
	if (filters.entityType) url.searchParams.set('type', filters.entityType);
	if (filters.archiveStatus) {
		url.searchParams.set('archiveStatus', filters.archiveStatus);
	}
	if (filters.countryCode)
		url.searchParams.set('countryCode', filters.countryCode);
	setBooleanFilter(url, 'active', filters.active);
	setBooleanFilter(url, 'fullValidator', filters.fullValidator);
	setBooleanFilter(url, 'topTier', filters.topTier);
	setBooleanFilter(url, 'validating', filters.validating);
	setBooleanFilter(url, 'validator', filters.validator);

	try {
		const response = await fetch(url, {
			cache: 'no-store',
			headers: { Accept: 'application/json' }
		});

		if (!response.ok) return emptySearchResponse(normalizedQuery);

		return response.json() as Promise<PublicSearchResponse>;
	} catch {
		return emptySearchResponse(normalizedQuery);
	}
}
