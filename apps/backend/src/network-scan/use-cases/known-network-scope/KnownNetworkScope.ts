export type KnownNodeScope =
	| 'current-validator'
	| 'listener'
	| 'public-key-only'
	| 'archived'
	| 'all-known';

export type KnownNodeRecordScope = Exclude<KnownNodeScope, 'all-known'>;
export type KnownOrganizationScope = 'current' | 'archived' | 'all-known';
export type KnownOrganizationRecordScope = Exclude<
	KnownOrganizationScope,
	'all-known'
>;

export interface KnownNetworkPageRequest<Scope extends string> {
	readonly limit: number;
	readonly offset: number;
	readonly query: string;
	readonly scope: Scope;
}

export interface KnownNetworkPageDTO {
	readonly hasMore: boolean;
	readonly limit: number;
	readonly offset: number;
	readonly total: number;
}

export const knownNetworkDefaultPageSize = 100;
export const knownNetworkMaxPageSize = 500;
export const knownNetworkMaxOffset = 1_000_000;

export const defaultKnownNodesRequest: KnownNetworkPageRequest<KnownNodeScope> =
	{
		limit: knownNetworkDefaultPageSize,
		offset: 0,
		query: '',
		scope: 'all-known'
	};

export const defaultKnownOrganizationsRequest: KnownNetworkPageRequest<KnownOrganizationScope> =
	{
		limit: knownNetworkDefaultPageSize,
		offset: 0,
		query: '',
		scope: 'all-known'
	};
