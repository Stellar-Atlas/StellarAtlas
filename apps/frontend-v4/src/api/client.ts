import type {
	ApiFailure,
	PublicKnownNodes,
	PublicKnownOrganizations,
	PublicApiStatus,
	PublicConfiguredServiceStatus,
	PublicDataQualityStatus,
	PublicExplorerAccount,
	PublicExplorerAssets,
	PublicExplorerContract,
	PublicExplorerLedger,
	PublicExplorerOperations,
	PublicExplorerOperationFilters,
	PublicExplorerSearch,
	PublicExplorerSearchType,
	PublicFailoverStatus,
	PublicHistoryArchiveScan,
	PublicHistoryArchiveScanLogEntry,
	PublicLatestLedger,
	PublicLedgerTransactions,
	PublicNetwork,
	PublicNode,
	PublicOrganization,
	PublicScpStatementObservation,
	PublicTransactionLookup,
	PublicWorkerStatus
} from './types';
import { frontendCacheTags } from './cache-policy';

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
	order?: 'asc' | 'desc';
	revalidate?: number;
	slotIndex?: string;
	source?: 'auto' | 'live' | 'stored';
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

	if (options.order !== undefined) {
		url.searchParams.set('order', options.order);
	}

	if (options.slotIndex !== undefined) {
		url.searchParams.set('slotIndex', options.slotIndex);
	}

	if (options.source !== undefined) {
		url.searchParams.set('source', options.source);
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
	const response = await fetch(
		buildApiUrl(path, options),
		buildFetchInit(options)
	);

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
	const response = await fetch(
		buildApiUrl(path, options),
		buildFetchInit(options)
	);

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
	fetchJson<PublicNetwork>(
		'/v1',
		withTags(options, [frontendCacheTags.network])
	);

export const fetchPublicNodes = (
	options?: FetchOptions
): Promise<PublicNode[]> =>
	fetchJson<PublicNode[]>(
		'/v1/nodes',
		withTags(options, [frontendCacheTags.network])
	);

export const fetchPublicNode = (
	publicKey: string,
	options?: FetchOptions
): Promise<PublicNode> =>
	fetchJson<PublicNode>(
		`/v1/nodes/${encodeURIComponent(publicKey)}`,
		withTags(options, [frontendCacheTags.network, `node:${publicKey}`])
	);

export const fetchKnownNodes = (
	options?: FetchOptions
): Promise<PublicKnownNodes> =>
	fetchJson<PublicKnownNodes>(
		'/v1/known/nodes',
		withTags(options, [frontendCacheTags.network])
	);

export const fetchPublicOrganizations = (
	options?: FetchOptions
): Promise<PublicOrganization[]> =>
	fetchJson<PublicOrganization[]>(
		'/v1/organizations',
		withTags(options, [
			frontendCacheTags.network,
			frontendCacheTags.organizations
		])
	);

export const fetchKnownOrganizations = (
	options?: FetchOptions
): Promise<PublicKnownOrganizations> =>
	fetchJson<PublicKnownOrganizations>(
		'/v1/known/organizations',
		withTags(options, [
			frontendCacheTags.network,
			frontendCacheTags.organizations
		])
	);

export const fetchPublicOrganization = (
	organizationId: string,
	options?: FetchOptions
): Promise<PublicOrganization> =>
	fetchJson<PublicOrganization>(
		`/v1/organizations/${encodeURIComponent(organizationId)}`,
		withTags(options, [
			frontendCacheTags.network,
			`organization:${organizationId}`
		])
	);

export const fetchHistoryArchiveScan = (
	historyUrl: string,
	options?: FetchOptions
): Promise<PublicHistoryArchiveScan | null> =>
	fetchNullableJson<PublicHistoryArchiveScan>(
		`/v1/history-scan/${encodeURIComponent(historyUrl)}`,
		withTags(options, [frontendCacheTags.historyScan])
	);

export const fetchHistoryArchiveScanLogs = (
	historyUrl: string,
	options?: FetchOptions
): Promise<PublicHistoryArchiveScanLogEntry[]> =>
	fetchJson<PublicHistoryArchiveScanLogEntry[]>(
		`/v1/history-scan/logs/${encodeURIComponent(historyUrl)}`,
		withTags(options, [frontendCacheTags.historyScan])
	);

export const fetchLatestLedger = (
	options?: FetchOptions
): Promise<PublicLatestLedger> =>
	fetchJson<PublicLatestLedger>('/v1/ledger/latest', options);

export const fetchLedgerTransactions = (
	slotIndex: string,
	options?: FetchOptions
): Promise<PublicLedgerTransactions> =>
	fetchJson<PublicLedgerTransactions>(
		`/v1/scp/slots/${encodeURIComponent(slotIndex)}/transactions`,
		options
	);

export const fetchTransactionByHash = (
	hash: string,
	options?: FetchOptions
): Promise<PublicTransactionLookup> =>
	fetchJson<PublicTransactionLookup>(
		`/v1/transactions/${encodeURIComponent(hash)}`,
		options
	);

export const fetchExplorerSearch = (
	query: string,
	type: PublicExplorerSearchType,
	options?: FetchOptions
): Promise<PublicExplorerSearch> => {
	const path = `/v1/explorer/search?query=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}`;
	return fetchJson<PublicExplorerSearch>(path, options);
};

export const fetchExplorerLedger = (
	sequence: string,
	options?: FetchOptions
): Promise<PublicExplorerLedger> =>
	fetchJson<PublicExplorerLedger>(
		`/v1/explorer/ledgers/${encodeURIComponent(sequence)}`,
		options
	);

export const fetchExplorerAccount = (
	accountId: string,
	options?: FetchOptions
): Promise<PublicExplorerAccount> =>
	fetchJson<PublicExplorerAccount>(
		`/v1/explorer/accounts/${encodeURIComponent(accountId)}`,
		options
	);

export const fetchExplorerAssets = (
	assetCode: string,
	assetIssuer: string,
	options?: FetchOptions
): Promise<PublicExplorerAssets> => {
	const params = new URLSearchParams();
	if (assetCode.trim().length > 0) params.set('assetCode', assetCode.trim());
	if (assetIssuer.trim().length > 0)
		params.set('assetIssuer', assetIssuer.trim());
	const query = params.toString();
	return fetchJson<PublicExplorerAssets>(
		`/v1/explorer/assets${query.length > 0 ? `?${query}` : ''}`,
		options
	);
};

export const fetchExplorerOperations = (
	filters: PublicExplorerOperationFilters,
	options?: FetchOptions
): Promise<PublicExplorerOperations> => {
	const params = new URLSearchParams();
	if (filters.accountId) params.set('accountId', filters.accountId);
	if (filters.from) params.set('from', filters.from);
	if (filters.ledger) params.set('ledger', filters.ledger);
	if (filters.operationType) params.set('operationType', filters.operationType);
	if (filters.to) params.set('to', filters.to);
	const query = params.toString();
	return fetchJson<PublicExplorerOperations>(
		`/v1/explorer/operations${query.length > 0 ? `?${query}` : ''}`,
		options
	);
};

export const fetchExplorerContract = (
	contractId: string,
	options?: FetchOptions
): Promise<PublicExplorerContract> =>
	fetchJson<PublicExplorerContract>(
		`/v1/explorer/contracts/${encodeURIComponent(contractId)}`,
		options
	);

export const fetchScpStatements = async (
	options?: ScpStatementFetchOptions
): Promise<PublicScpStatementObservation[]> => {
	const response = await fetch(
		buildScpStatementUrl(options),
		buildFetchInit(withTags(options, [frontendCacheTags.scpStatements]))
	);

	if (!response.ok) {
		throw new ApiClientError({
			message: `API request returned HTTP ${response.status}`,
			statusCode: response.status
		});
	}

	return response.json() as Promise<PublicScpStatementObservation[]>;
};

export const fetchApiStatus = (
	options?: FetchOptions
): Promise<PublicApiStatus> =>
	fetchJson<PublicApiStatus>(
		'/v1/status/api',
		withTags(options, [frontendCacheTags.status])
	);

export const fetchDataQualityStatus = (
	options?: FetchOptions
): Promise<PublicDataQualityStatus> =>
	fetchJson<PublicDataQualityStatus>(
		'/v1/status/data-quality',
		withTags(options, [frontendCacheTags.status])
	);

export const fetchWorkerStatus = (
	options?: FetchOptions
): Promise<PublicWorkerStatus> =>
	fetchJson<PublicWorkerStatus>(
		'/v1/status/workers',
		withTags(options, [frontendCacheTags.status])
	);

export const fetchFrontendStatus = (
	options?: FetchOptions
): Promise<PublicConfiguredServiceStatus> =>
	fetchJson<PublicConfiguredServiceStatus>(
		'/v1/status/frontend',
		withTags(options, [frontendCacheTags.status])
	);

export const fetchHorizonStatus = (
	options?: FetchOptions
): Promise<PublicConfiguredServiceStatus> =>
	fetchJson<PublicConfiguredServiceStatus>(
		'/v1/status/horizon',
		withTags(options, [frontendCacheTags.status])
	);

export const fetchRpcStatus = (
	options?: FetchOptions
): Promise<PublicConfiguredServiceStatus> =>
	fetchJson<PublicConfiguredServiceStatus>(
		'/v1/status/rpc',
		withTags(options, [frontendCacheTags.status])
	);

export const fetchFailoverStatus = (
	options?: FetchOptions
): Promise<PublicFailoverStatus> =>
	fetchJson<PublicFailoverStatus>(
		'/v1/status/failover',
		withTags(options, [frontendCacheTags.status])
	);
