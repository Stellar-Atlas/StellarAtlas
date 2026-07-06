import type { PublicKnownNode, PublicKnownOrganization } from './types';
import { ApiClientError, fetchJson, type FetchOptions } from './client';
import { frontendCacheTags } from './cache-policy';

export const fetchKnownNode = (
	publicKey: string,
	options?: FetchOptions
): Promise<PublicKnownNode | null> =>
	fetchKnownRecord(`/v1/known/nodes/${encodeURIComponent(publicKey)}`, options);

export const fetchKnownOrganization = (
	organizationId: string,
	options?: FetchOptions
): Promise<PublicKnownOrganization | null> =>
	fetchKnownRecord(
		`/v1/known/organizations/${encodeURIComponent(organizationId)}`,
		options
	);

async function fetchKnownRecord<Record>(
	path: string,
	options?: FetchOptions
): Promise<Record | null> {
	try {
		return await fetchJson<Record>(path, withNetworkTags(options));
	} catch (error) {
		if (error instanceof ApiClientError && error.statusCode === 404) {
			return null;
		}
		throw error;
	}
}

function withNetworkTags(options: FetchOptions | undefined): FetchOptions {
	return {
		...options,
		tags: [frontendCacheTags.network, ...(options?.tags ?? [])]
	};
}
