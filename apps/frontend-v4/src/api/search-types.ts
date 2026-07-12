import type { PublicKnownNodeScope } from './known-network-types';

export type PublicSearchEntityType = 'archive-root' | 'node' | 'organization';
export type PublicSearchArchiveStatus = 'error' | 'ok' | 'unknown';
export type PublicSearchDocumentScope =
	| Exclude<PublicKnownNodeScope, 'all-known'>
	| 'archive-root'
	| 'current-organization';
export type PublicSearchRecordState =
	'current' | 'historical' | 'identity-only';
export type PublicSearchFacetName =
	| 'active'
	| 'archiveStatus'
	| 'countryCode'
	| 'entityType'
	| 'fullValidator'
	| 'scope'
	| 'topTier'
	| 'validating'
	| 'validator';
export type PublicSearchResultSource = 'meilisearch' | 'postgres_canonical';
export type PublicSearchSource = PublicSearchResultSource | 'unavailable';

export interface PublicSearchHit {
	readonly detail: string;
	readonly entityId: string;
	readonly entityType: PublicSearchEntityType;
	readonly evidenceFailures?: number;
	readonly evidenceProvenance?: 'postgres_canonical';
	readonly evidenceVerified?: number;
	readonly freshness: 'fresh';
	readonly href: string;
	readonly id: string;
	readonly label: string;
	readonly observedAt: string;
	readonly organizationName?: string;
	readonly recordState: PublicSearchRecordState;
	readonly scope: PublicSearchDocumentScope;
	readonly source: PublicSearchResultSource;
}

export interface PublicSearchFacetValue {
	readonly count: number;
	readonly value: string;
}

export type PublicSearchFacets = Record<
	PublicSearchFacetName,
	readonly PublicSearchFacetValue[]
>;

export interface PublicSearchPagination {
	readonly hasMore: boolean;
	readonly limit: number;
	readonly offset: number;
	readonly total: number;
	readonly totalIsExact: boolean;
}

export type PublicSearchFallbackReason =
	| 'canonical_unavailable'
	| 'meilisearch_stale'
	| 'meilisearch_syncing'
	| 'meilisearch_unavailable'
	| 'meilisearch_unconfigured';

export interface PublicSearchResponse {
	readonly estimatedTotalHits: number;
	readonly facets: PublicSearchFacets;
	readonly hits: readonly PublicSearchHit[];
	readonly indexedNetworkTime: string | null;
	readonly pagination: PublicSearchPagination;
	readonly query: string;
	readonly readModel: {
		readonly canonicalCursor: string | null;
		readonly fallbackReason: PublicSearchFallbackReason | null;
		readonly freshness: 'fresh' | 'stale' | 'unavailable';
		readonly observedAt: string | null;
		readonly schemaVersion: string;
		readonly source: PublicSearchSource;
	};
	readonly scope: PublicKnownNodeScope;
	readonly source: PublicSearchSource;
}
