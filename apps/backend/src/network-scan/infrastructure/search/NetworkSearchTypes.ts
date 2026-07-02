export type NetworkSearchEntityType = 'node' | 'organization';

export interface NetworkSearchConfig {
	readonly apiKey?: string;
	readonly host?: string;
	readonly indexName: string;
}

export interface NetworkSearchDocument {
	readonly active?: boolean;
	readonly archiveStatus?: 'error' | 'ok' | 'unknown';
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
	readonly entityType?: NetworkSearchEntityType;
	readonly limit: number;
	readonly query: string;
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

export interface NetworkSearchResponse {
	readonly estimatedTotalHits: number;
	readonly hits: readonly NetworkSearchHit[];
	readonly indexedNetworkTime: string;
	readonly query: string;
	readonly source: 'memory' | 'meilisearch';
}
