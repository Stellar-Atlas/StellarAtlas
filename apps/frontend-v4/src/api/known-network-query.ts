import type {
	PublicKnownNodesQuery,
	PublicKnownOrganizationsQuery
} from './known-network-types';

export function buildKnownNodesPath(query: PublicKnownNodesQuery = {}): string {
	return buildKnownInventoryPath('/v1/known/nodes', query);
}

export function buildKnownOrganizationsPath(
	query: PublicKnownOrganizationsQuery = {}
): string {
	return buildKnownInventoryPath('/v1/known/organizations', query);
}

function buildKnownInventoryPath(
	basePath: string,
	query: {
		readonly limit?: number;
		readonly offset?: number;
		readonly query?: string;
		readonly scope?: string;
	}
): string {
	const params = new URLSearchParams();
	if (query.scope !== undefined) params.set('scope', query.scope);
	if (query.query !== undefined && query.query.length > 0)
		params.set('q', query.query);
	if (query.limit !== undefined) params.set('limit', query.limit.toString());
	if (query.offset !== undefined) params.set('offset', query.offset.toString());
	const queryString = params.toString();
	return queryString.length === 0 ? basePath : `${basePath}?${queryString}`;
}
