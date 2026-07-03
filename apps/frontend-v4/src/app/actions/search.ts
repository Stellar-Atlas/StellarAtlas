'use server';

import type { PublicSearchResponse } from '../../api/types';

const getInternalApiBaseUrl = (): string => {
	const configuredUrl =
		process.env.STELLAR_ATLAS_INTERNAL_API_URL?.trim() ||
		process.env.STELLAR_ATLAS_PUBLIC_API_URL?.trim() ||
		'http://127.0.0.1:3000';
	return configuredUrl.endsWith('/')
		? configuredUrl.slice(0, -1)
		: configuredUrl;
};

export async function searchNetwork(
	query: string
): Promise<PublicSearchResponse> {
	const normalizedQuery = query.trim();
	const url = new URL('/v1/search', getInternalApiBaseUrl());
	url.searchParams.set('q', normalizedQuery);
	url.searchParams.set('limit', '8');

	const response = await fetch(url, {
		cache: 'no-store',
		headers: { Accept: 'application/json' }
	});

	if (!response.ok) {
		throw new Error(`Search request returned ${response.status}`);
	}

	return response.json() as Promise<PublicSearchResponse>;
}
