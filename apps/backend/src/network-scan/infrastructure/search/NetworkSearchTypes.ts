import type { KnownArchiveEvidenceV1, NetworkV1 } from 'shared';
import type { KnownNodeListItemDTO } from '../../use-cases/get-known-nodes/GetKnownNodesDTO.js';
import type { KnownOrganizationListItemDTO } from '../../use-cases/get-known-organizations/GetKnownOrganizationsDTO.js';
import type {
	KnownNodeRecordScope,
	KnownNodeScope
} from '../../use-cases/known-network-scope/KnownNetworkScope.js';

export type NetworkSearchEntityType = 'archive-root' | 'node' | 'organization';
export type NetworkSearchArchiveStatus = 'error' | 'ok' | 'unknown';
export type NetworkSearchDocumentScope =
	KnownNodeRecordScope | 'archive-root' | 'current-organization';
export type NetworkSearchRecordState =
	'current' | 'historical' | 'identity-only';
export type NetworkSearchFreshness = 'fresh' | 'stale';
export type NetworkSearchFacetName =
	| 'active'
	| 'archiveStatus'
	| 'countryCode'
	| 'entityType'
	| 'fullValidator'
	| 'scope'
	| 'topTier'
	| 'validating'
	| 'validator';

export interface NetworkSearchConfig {
	readonly apiKey?: string;
	readonly host?: string;
	readonly indexName: string;
	readonly writable?: boolean;
}

export interface NetworkSearchInventory {
	readonly archiveRoots: KnownArchiveEvidenceV1['roots'];
	readonly canonicalArchiveRevision: string;
	readonly generatedAt: string;
	readonly network: NetworkV1;
	readonly nodes: readonly KnownNodeListItemDTO[];
	readonly organizations: readonly KnownOrganizationListItemDTO[];
}

export interface NetworkSearchDocument {
	readonly active?: boolean;
	readonly archiveStatus?: NetworkSearchArchiveStatus;
	readonly evidenceFailures?: number;
	readonly evidenceProvenance?: 'postgres_canonical';
	readonly evidenceVerified?: number;
	readonly canonicalCursor: string;
	readonly content: string;
	readonly countryCode?: string;
	readonly countryName?: string;
	readonly detail: string;
	readonly documentKind: 'entity';
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
	readonly observedAt: string;
	readonly organizationId?: string;
	readonly organizationName?: string;
	readonly publicKey?: string;
	readonly recordState: NetworkSearchRecordState;
	readonly scope: NetworkSearchDocumentScope;
	readonly topTier?: boolean;
	readonly validating?: boolean;
	readonly validator?: boolean;
	readonly version?: string;
}

export interface NetworkSearchIndexStateDocument {
	readonly canonicalArchiveRevision: string;
	readonly canonicalCursor: string;
	readonly documentKind: 'state';
	readonly id: string;
	readonly indexedAt: string;
	readonly networkTime: string;
}

export type NetworkSearchStoredDocument =
	NetworkSearchDocument | NetworkSearchIndexStateDocument;

export interface NetworkSearchSnapshot {
	readonly canonicalArchiveRevision: string;
	readonly canonicalCursor: string;
	readonly documents: readonly NetworkSearchDocument[];
	readonly generatedAt: string;
	readonly networkTime: string;
}

export interface NetworkSearchRequest {
	readonly active?: boolean;
	readonly archiveStatus?: NetworkSearchArchiveStatus;
	readonly canonicalCursor?: string;
	readonly countryCode?: string;
	readonly entityType?: NetworkSearchEntityType;
	readonly fullValidator?: boolean;
	readonly limit: number;
	readonly offset: number;
	readonly organizationId?: string;
	readonly query: string;
	readonly scope: KnownNodeScope;
	readonly topTier?: boolean;
	readonly validating?: boolean;
	readonly validator?: boolean;
}

export interface NetworkSearchHit {
	readonly detail: string;
	readonly entityId: string;
	readonly entityType: NetworkSearchEntityType;
	readonly evidenceFailures?: number;
	readonly evidenceProvenance?: 'postgres_canonical';
	readonly evidenceVerified?: number;
	readonly freshness: NetworkSearchFreshness;
	readonly href: string;
	readonly id: string;
	readonly label: string;
	readonly observedAt: string;
	readonly organizationName?: string;
	readonly recordState: NetworkSearchRecordState;
	readonly scope: NetworkSearchDocumentScope;
	readonly source: 'meilisearch' | 'postgres_canonical';
}

export interface NetworkSearchFacetValue {
	readonly count: number;
	readonly value: string;
}

export type NetworkSearchFallbackReason =
	| 'meilisearch_stale'
	| 'meilisearch_syncing'
	| 'meilisearch_unavailable'
	| 'meilisearch_unconfigured';

export interface NetworkSearchReadModel {
	readonly canonicalCursor: string;
	readonly fallbackReason: NetworkSearchFallbackReason | null;
	readonly freshness: NetworkSearchFreshness;
	readonly observedAt: string;
	readonly schemaVersion: string;
	readonly source: 'meilisearch' | 'postgres_canonical';
}

export type NetworkSearchFacets = Record<
	NetworkSearchFacetName,
	readonly NetworkSearchFacetValue[]
>;

export interface NetworkSearchPagination {
	readonly hasMore: boolean;
	readonly limit: number;
	readonly offset: number;
	readonly total: number;
	readonly totalIsExact: boolean;
}

export interface NetworkSearchResponse {
	readonly estimatedTotalHits: number;
	readonly facets: NetworkSearchFacets;
	readonly hits: readonly NetworkSearchHit[];
	readonly indexedNetworkTime: string;
	readonly pagination: NetworkSearchPagination;
	readonly query: string;
	readonly readModel: NetworkSearchReadModel;
	readonly scope: KnownNodeScope;
	readonly source: 'meilisearch' | 'postgres_canonical';
}
