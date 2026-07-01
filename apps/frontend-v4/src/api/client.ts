import type {
	ApiFailure,
	PublicNetwork,
	PublicNode,
	PublicOrganization
} from './types';

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

interface FetchOptions {
	at?: Date;
}

const buildApiUrl = (path: string, options: FetchOptions = {}): string => {
	const url = new URL(`${getApiBaseUrl()}${path}`);

	if (options.at) {
		url.searchParams.set('at', options.at.toISOString());
	}

	return url.toString();
};

const fetchJson = async <Payload>(
	path: string,
	options: FetchOptions = {}
): Promise<Payload> => {
	const response = await fetch(buildApiUrl(path, options), {
		cache: 'no-store',
		headers: {
			Accept: 'application/json'
		}
	});

	if (!response.ok) {
		throw new ApiClientError({
			message: `API request returned HTTP ${response.status}`,
			statusCode: response.status
		});
	}

	return response.json() as Promise<Payload>;
};

export const fetchPublicNetwork = (
	options?: FetchOptions
): Promise<PublicNetwork> => fetchJson<PublicNetwork>('/v1', options);

export const fetchPublicNodes = (
	options?: FetchOptions
): Promise<PublicNode[]> => fetchJson<PublicNode[]>('/v1/nodes', options);

export const fetchPublicNode = (
	publicKey: string,
	options?: FetchOptions
): Promise<PublicNode> =>
	fetchJson<PublicNode>(`/v1/nodes/${encodeURIComponent(publicKey)}`, options);

export const fetchPublicOrganizations = (
	options?: FetchOptions
): Promise<PublicOrganization[]> =>
	fetchJson<PublicOrganization[]>('/v1/organizations', options);

export const fetchPublicOrganization = (
	organizationId: string,
	options?: FetchOptions
): Promise<PublicOrganization> =>
	fetchJson<PublicOrganization>(
		`/v1/organizations/${encodeURIComponent(organizationId)}`,
		options
	);
