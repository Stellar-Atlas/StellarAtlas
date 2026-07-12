import type { PublicKnownNodeScope } from './known-network-types';
import type {
	PublicSearchArchiveStatus,
	PublicSearchEntityType,
	PublicSearchFacetName
} from './search-types';

export interface SearchNetworkFilters {
	active?: boolean;
	archiveStatus?: PublicSearchArchiveStatus;
	countryCode?: string;
	entityType?: PublicSearchEntityType;
	fullValidator?: boolean;
	offset?: number;
	scope?: PublicKnownNodeScope;
	topTier?: boolean;
	validating?: boolean;
	validator?: boolean;
}

export function buildNetworkSearchPath(
	query: string,
	filters: SearchNetworkFilters,
	limit = 8
): string {
	const params = new URLSearchParams();
	params.set('q', query.trim());
	params.set('limit', limit.toString());
	params.set('offset', String(filters.offset ?? 0));
	params.set('scope', filters.scope ?? 'all-known');
	if (filters.entityType) params.set('type', filters.entityType);
	if (filters.archiveStatus) {
		params.set('archiveStatus', filters.archiveStatus);
	}
	if (filters.countryCode) params.set('countryCode', filters.countryCode);
	setBooleanFilter(params, 'active', filters.active);
	setBooleanFilter(params, 'fullValidator', filters.fullValidator);
	setBooleanFilter(params, 'topTier', filters.topTier);
	setBooleanFilter(params, 'validating', filters.validating);
	setBooleanFilter(params, 'validator', filters.validator);
	return `/v1/search?${params.toString()}`;
}

function setBooleanFilter(
	params: URLSearchParams,
	name: PublicSearchFacetName,
	value: boolean | undefined
): void {
	if (value !== undefined) params.set(name, value ? 'true' : 'false');
}
