export type NetworkSearchEntityType = 'node' | 'organization';
export type NetworkSearchArchiveStatus = 'error' | 'ok' | 'unknown';
export type NetworkSearchFacetName =
	| 'active'
	| 'archiveStatus'
	| 'countryCode'
	| 'entityType'
	| 'fullValidator'
	| 'topTier'
	| 'validating'
	| 'validator';

export interface NetworkSearchConfig {
	readonly apiKey?: string;
	readonly host?: string;
	readonly indexName: string;
}

export interface NetworkSearchDocument {
	readonly active?: boolean;
	readonly archiveStatus?: NetworkSearchArchiveStatus;
	readonly content: string;
	readonly countryCode?: string;
	readonly countryName?: string;
	readonly detail: string;
	readonly entityId: string;
	readonly entityType: NetworkSearchEntityType;
	readonly fullValidator?: boolean;
	readonly homeDomain?: string;
	readonly href: string;
	readonly id: string;
	readonly indexedAt: string;
	readonly isp?: string;
	readonly label: string;
	readonly latestLedger: string;
	readonly networkTime: string;
	readonly organizationId?: string;
	readonly organizationName?: string;
	readonly publicKey?: string;
	readonly topTier?: boolean;
	readonly validating?: boolean;
	readonly validator?: boolean;
	readonly version?: string;
}

export interface NetworkSearchRequest {
	readonly active?: boolean;
	readonly archiveStatus?: NetworkSearchArchiveStatus;
	readonly countryCode?: string;
	readonly entityType?: NetworkSearchEntityType;
	readonly fullValidator?: boolean;
	readonly limit: number;
	readonly organizationId?: string;
	readonly query: string;
	readonly topTier?: boolean;
	readonly validating?: boolean;
	readonly validator?: boolean;
}

export interface NetworkSearchHit {
	readonly detail: string;
	readonly entityId: string;
	readonly entityType: NetworkSearchEntityType;
	readonly href: string;
	readonly id: string;
	readonly label: string;
	readonly organizationName?: string;
}

export interface NetworkSearchFacetValue {
	readonly count: number;
	readonly value: string;
}

export type NetworkSearchFallbackReason =
	| 'meilisearch_syncing'
	| 'meilisearch_unavailable'
	| 'meilisearch_unconfigured';

export interface NetworkSearchReadModel {
	readonly fallbackReason: NetworkSearchFallbackReason | null;
	readonly schemaVersion: string;
}

export type NetworkSearchFacets = Record<
	NetworkSearchFacetName,
	readonly NetworkSearchFacetValue[]
>;

export interface NetworkSearchResponse {
	readonly estimatedTotalHits: number;
	readonly facets: NetworkSearchFacets;
	readonly hits: readonly NetworkSearchHit[];
	readonly indexedNetworkTime: string;
	readonly query: string;
	readonly readModel: NetworkSearchReadModel;
	readonly source: 'memory' | 'meilisearch';
}
