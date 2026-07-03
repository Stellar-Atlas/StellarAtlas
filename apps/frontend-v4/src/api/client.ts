import type {
	ApiFailure,
	PublicHistoryArchiveScan,
	PublicHistoryArchiveScanLogEntry,
	PublicNetwork,
	PublicNode,
	PublicOrganization,
	PublicScpStatementObservation
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
	cache?: 'no-store';
	revalidate?: number;
	tags?: string[];
}

interface ScpStatementFetchOptions {
	cache?: 'no-store';
	limit?: number;
	nodeId?: string;
	revalidate?: number;
	slotIndex?: string;
	tags?: string[];
}

interface NextFetchInit extends RequestInit {
	next?: {
		revalidate?: number;
		tags?: string[];
	};
}

const DEFAULT_REVALIDATE_SECONDS = 10;

const buildApiUrl = (path: string, options: FetchOptions = {}): string => {
	const url = new URL(`${getApiBaseUrl()}${path}`);

	if (options.at) {
		url.searchParams.set('at', options.at.toISOString());
	}

	return url.toString();
};

const buildScpStatementUrl = (
	options: ScpStatementFetchOptions = {}
): string => {
	const url = new URL(`${getApiBaseUrl()}/v1/scp-statements`);

	if (options.limit !== undefined) {
		url.searchParams.set('limit', options.limit.toString());
	}

	if (options.nodeId !== undefined) {
		url.searchParams.set('nodeId', options.nodeId);
	}

	if (options.slotIndex !== undefined) {
		url.searchParams.set('slotIndex', options.slotIndex);
	}

	return url.toString();
};

const buildFetchInit = (options: FetchOptions = {}): NextFetchInit => {
	const init: NextFetchInit = {
		headers: {
			Accept: 'application/json'
		}
	};

	if (options.cache === 'no-store') {
		return {
			...init,
			cache: 'no-store'
		};
	}

	return {
		...init,
		next: {
			revalidate: options.revalidate ?? DEFAULT_REVALIDATE_SECONDS,
			tags: options.tags
		}
	};
};

const withTags = <Options extends FetchOptions | ScpStatementFetchOptions>(
	options: Options | undefined,
	tags: readonly string[]
): Options => {
	return {
		...options,
		tags: [...tags, ...(options?.tags ?? [])]
	} as Options;
};

const fetchJson = async <Payload>(
	path: string,
	options: FetchOptions = {}
): Promise<Payload> => {
	const response = await fetch(buildApiUrl(path, options), buildFetchInit(options));

	if (!response.ok) {
		throw new ApiClientError({
			message: `API request returned HTTP ${response.status}`,
			statusCode: response.status
		});
	}

	return response.json() as Promise<Payload>;
};

const fetchNullableJson = async <Payload>(
	path: string,
	options: FetchOptions = {}
): Promise<Payload | null> => {
	const response = await fetch(buildApiUrl(path, options), buildFetchInit(options));

	if (response.status === 204) return null;
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
): Promise<PublicNetwork> =>
	fetchJson<PublicNetwork>('/v1', withTags(options, ['network']));

export const fetchPublicNodes = (
	options?: FetchOptions
): Promise<PublicNode[]> =>
	fetchJson<PublicNode[]>('/v1/nodes', withTags(options, ['network']));

export const fetchPublicNode = (
	publicKey: string,
	options?: FetchOptions
): Promise<PublicNode> =>
	fetchJson<PublicNode>(
		`/v1/nodes/${encodeURIComponent(publicKey)}`,
		withTags(options, ['network', `node:${publicKey}`])
	);

export const fetchPublicOrganizations = (
	options?: FetchOptions
): Promise<PublicOrganization[]> =>
	fetchJson<PublicOrganization[]>(
		'/v1/organizations',
		withTags(options, ['network', 'organizations'])
	);

export const fetchPublicOrganization = (
	organizationId: string,
	options?: FetchOptions
): Promise<PublicOrganization> =>
	fetchJson<PublicOrganization>(
		`/v1/organizations/${encodeURIComponent(organizationId)}`,
		withTags(options, ['network', `organization:${organizationId}`])
	);

export const fetchHistoryArchiveScan = (
	historyUrl: string,
	options?: FetchOptions
): Promise<PublicHistoryArchiveScan | null> =>
	fetchNullableJson<PublicHistoryArchiveScan>(
		`/v1/history-scan/${encodeURIComponent(historyUrl)}`,
		withTags(options, ['history-scan'])
	);

export const fetchHistoryArchiveScanLogs = (
	historyUrl: string,
	options?: FetchOptions
): Promise<PublicHistoryArchiveScanLogEntry[]> =>
	fetchJson<PublicHistoryArchiveScanLogEntry[]>(
		`/v1/history-scan/logs/${encodeURIComponent(historyUrl)}`,
		withTags(options, ['history-scan'])
	);

export const fetchScpStatements = async (
	options?: ScpStatementFetchOptions
): Promise<PublicScpStatementObservation[]> => {
	const response = await fetch(
		buildScpStatementUrl(options),
		buildFetchInit(withTags(options, ['scp-statements']))
	);

	if (!response.ok) {
		throw new ApiClientError({
			message: `API request returned HTTP ${response.status}`,
			statusCode: response.status
		});
	}

	return response.json() as Promise<PublicScpStatementObservation[]>;
};
