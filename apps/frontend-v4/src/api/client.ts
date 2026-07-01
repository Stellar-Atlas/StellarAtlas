import type { ApiFailure, PublicNetwork } from './types';

const DEFAULT_API_BASE_URL = 'http://localhost:3000';

export class ApiClientError extends Error {
	readonly statusCode?: number;

	constructor(failure: ApiFailure) {
		super(failure.message);
		this.name = 'ApiClientError';
		this.statusCode = failure.statusCode;
	}
}

export const getApiBaseUrl = (): string => {
	const configuredUrl = process.env.STELLAR_ATLAS_PUBLIC_API_URL?.trim();
	const baseUrl =
		configuredUrl && configuredUrl.length > 0
			? configuredUrl
			: DEFAULT_API_BASE_URL;

	return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
};

export const fetchPublicNetwork = async (): Promise<PublicNetwork> => {
	const response = await fetch(`${getApiBaseUrl()}/v1`, {
		cache: 'no-store',
		headers: {
			Accept: 'application/json'
		}
	});

	if (!response.ok) {
		throw new ApiClientError({
			message: `Network API returned HTTP ${response.status}`,
			statusCode: response.status
		});
	}

	return response.json() as Promise<PublicNetwork>;
};
