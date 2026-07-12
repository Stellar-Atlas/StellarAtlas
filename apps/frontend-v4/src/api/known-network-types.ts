import type { NodeV1, OrganizationV1 } from 'shared';

export type PublicKnownNodeMetadataState = 'snapshot' | 'public_key_only';
export type PublicKnownNodeScope =
	| 'current-validator'
	| 'listener'
	| 'public-key-only'
	| 'archived'
	| 'all-known';
export type PublicKnownNodeRecordScope = Exclude<
	PublicKnownNodeScope,
	'all-known'
>;
export type PublicKnownOrganizationScope = 'current' | 'archived' | 'all-known';
export type PublicKnownOrganizationRecordScope = Exclude<
	PublicKnownOrganizationScope,
	'all-known'
>;

export interface PublicKnownNetworkPage {
	readonly hasMore: boolean;
	readonly limit: number;
	readonly offset: number;
	readonly total: number;
}

export interface PublicKnownNodesQuery {
	readonly limit?: number;
	readonly offset?: number;
	readonly query?: string;
	readonly scope?: PublicKnownNodeScope;
}

export interface PublicKnownOrganizationsQuery {
	readonly limit?: number;
	readonly offset?: number;
	readonly query?: string;
	readonly scope?: PublicKnownOrganizationScope;
}

export interface PublicKnownNode {
	readonly current: boolean;
	readonly dateDiscovered: string;
	readonly lastMeasurementAt: string | null;
	readonly lastSeen: string | null;
	readonly metadataState: PublicKnownNodeMetadataState;
	readonly node: NodeV1 | null;
	readonly publicKey: string;
	readonly scope: PublicKnownNodeRecordScope;
	readonly snapshotEndDate: string | null;
	readonly snapshotStartDate: string | null;
}

export type PublicKnownNodeListItem = PublicKnownNode;

export type PublicKnownNodeScopeTotals = Record<PublicKnownNodeScope, number>;

export interface PublicKnownNodes {
	readonly count: number;
	readonly generatedAt: string;
	readonly nodes: readonly PublicKnownNodeListItem[];
	readonly page: PublicKnownNetworkPage;
	readonly scope: PublicKnownNodeScope;
	readonly scopeTotals: PublicKnownNodeScopeTotals;
	readonly source: 'postgres_canonical';
}

export interface PublicKnownOrganization {
	readonly current: boolean;
	readonly lastMeasurementAt: string | null;
	readonly lastSeen: string | null;
	readonly organization: OrganizationV1;
	readonly scope: PublicKnownOrganizationRecordScope;
	readonly snapshotEndDate: string | null;
	readonly snapshotStartDate: string;
}

export type PublicKnownOrganizationListItem = PublicKnownOrganization;

export type PublicKnownOrganizationScopeTotals = Record<
	PublicKnownOrganizationScope,
	number
>;

export interface PublicKnownOrganizations {
	readonly count: number;
	readonly generatedAt: string;
	readonly organizations: readonly PublicKnownOrganizationListItem[];
	readonly page: PublicKnownNetworkPage;
	readonly scope: PublicKnownOrganizationScope;
	readonly scopeTotals: PublicKnownOrganizationScopeTotals;
	readonly source: 'postgres_canonical';
}
