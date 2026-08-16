import { frontendCacheTags } from './cache-policy';
import { fetchValidatedJson, type FetchOptions } from './http-client';
import { parsePublicSearchResponse } from './search-response-parser';
import {
	buildNetworkSearchPath,
	type SearchNetworkFilters
} from './search-request';
import type { PublicSearchResponse } from './search-types';

export const fetchNetworkSearch = (
	query: string,
	filters: SearchNetworkFilters = {},
	limit = 8,
	options?: FetchOptions
): Promise<PublicSearchResponse> =>
	fetchValidatedJson(
		buildNetworkSearchPath(query, filters, limit),
		parsePublicSearchResponse,
		{
			...options,
			tags: [frontendCacheTags.network, ...(options?.tags ?? [])]
		}
	);
