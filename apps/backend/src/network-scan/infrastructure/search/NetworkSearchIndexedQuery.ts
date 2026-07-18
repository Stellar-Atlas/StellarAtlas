import type { Index } from 'meilisearch';
import {
	buildFacetsFromDistribution,
	buildMeilisearchFilter,
	deriveSearchTotal,
	networkSearchFacetAttributes,
	networkSearchHitAttributes,
	networkSearchMaxOffset,
	sanitizeSearchLimit,
	sanitizeSearchOffset,
	toSearchHit
} from './NetworkSearchQuery.js';
import type {
	NetworkSearchDocument,
	NetworkSearchIndexStateDocument,
	NetworkSearchReadModel,
	NetworkSearchRequest,
	NetworkSearchResponse,
	NetworkSearchStoredDocument
} from './NetworkSearchTypes.js';

export async function queryNetworkSearchIndex(
	index: Index<NetworkSearchStoredDocument>,
	state: NetworkSearchIndexStateDocument,
	request: NetworkSearchRequest,
	readModel: NetworkSearchReadModel
): Promise<NetworkSearchResponse> {
	const limit = sanitizeSearchLimit(request.limit);
	const offset = sanitizeSearchOffset(request.offset);
	const response = await index.search<NetworkSearchDocument>(request.query, {
		attributesToRetrieve: [...networkSearchHitAttributes],
		facets: [...networkSearchFacetAttributes],
		filter: buildMeilisearchFilter(request, state.canonicalCursor),
		limit,
		offset,
		sort: ['label:asc', 'id:asc']
	});
	const total = deriveSearchTotal(
		response.facetDistribution,
		response.estimatedTotalHits,
		response.hits.length,
		offset
	);

	return {
		estimatedTotalHits: total.value,
		facets: buildFacetsFromDistribution(response.facetDistribution),
		hits: response.hits.map((hit) => toSearchHit(hit, 'meilisearch', 'fresh')),
		indexedNetworkTime: state.networkTime,
		pagination: {
			hasMore: total.exact
				? offset + response.hits.length < total.value
				: response.hits.length === limit &&
					offset + response.hits.length < networkSearchMaxOffset,
			limit,
			offset,
			total: total.value,
			totalIsExact: total.exact
		},
		query: request.query,
		readModel,
		scope: request.scope,
		source: 'meilisearch'
	};
}

export const networkSearchGenerationMatches = (
	left: NetworkSearchIndexStateDocument,
	right: NetworkSearchIndexStateDocument
): boolean =>
	left.canonicalArchiveRevision === right.canonicalArchiveRevision &&
	left.canonicalCursor === right.canonicalCursor &&
	left.networkTime === right.networkTime;
