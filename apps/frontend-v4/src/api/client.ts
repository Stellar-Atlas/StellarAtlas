import type {
	PublicKnownNodes,
	PublicKnownOrganizations,
	PublicKnownNodesQuery,
	PublicKnownOrganizationsQuery,
	PublicApiStatus,
	PublicConfiguredServiceStatus,
	PublicDataQualityStatus,
	PublicExplorerLocalAccountChanges,
	PublicExplorerAssets,
	PublicExplorerContract,
	PublicExplorerLedger,
	PublicExplorerOperations,
	PublicExplorerOperationFilters,
	PublicExplorerSearch,
	PublicExplorerSearchType,
	PublicFailoverStatus,
	PublicFullHistoryStatus,
	PublicHistoryArchiveObjectQueue,
	PublicHistoryArchiveObjectSummary,
	PublicHistoryArchiveScan,
	PublicHistoryArchiveScanEvidence,
	PublicHistoryArchiveScanLogEntry,
	PublicHistoryArchiveState,
	PublicLatestLedger,
	PublicLedgerTransactions,
	PublicNetwork,
	PublicNode,
	PublicOrganization,
	PublicRecentTransactions,
	PublicScpStatementObservation,
	PublicScanLogStatus,
	PublicTransactionLookup,
	PublicWorkerStatus
} from './types';
import { frontendCacheTags } from './cache-policy';
import { parseFullHistoryStatus } from './full-history-status-contract';
import { parseExplorerLocalAccountChanges } from './explorer-local-account-contract';
import { parseWorkerStatusDTO } from './worker-status-parser';
import {
	buildKnownNodesPath,
	buildKnownOrganizationsPath
} from './known-network-query';
import {
	ApiClientError,
	buildFetchInit,
	fetchJson,
	fetchNullableJson,
	fetchValidatedJson,
	getApiBaseUrl,
	type FetchOptions
} from './http-client';
export {
	ApiClientError,
	fetchJson,
	fetchValidatedJson,
	getApiBaseUrl,
	type FetchOptions
} from './http-client';

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

const withTags = <Options extends FetchOptions | ScpStatementFetchOptions>(
	options: Options | undefined,
	tags: readonly string[]
): Options => {
	return {
		...options,
		tags: [...tags, ...(options?.tags ?? [])]
	} as Options;
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
	query: PublicKnownNodesQuery = {},
	options?: FetchOptions
): Promise<PublicKnownNodes> =>
	fetchJson<PublicKnownNodes>(
		buildKnownNodesPath(query),
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
	query: PublicKnownOrganizationsQuery = {},
	options?: FetchOptions
): Promise<PublicKnownOrganizations> =>
	fetchJson<PublicKnownOrganizations>(
		buildKnownOrganizationsPath(query),
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

export const fetchHistoryArchiveState = (
	historyUrl: string,
	options?: FetchOptions
): Promise<PublicHistoryArchiveState | null> =>
	fetchNullableJson<PublicHistoryArchiveState>(
		`/v1/archive-scans/${encodeURIComponent(historyUrl)}/state`,
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

export const fetchHistoryArchiveScanEvidence = (
	historyUrl: string,
	limit: number,
	options?: FetchOptions
): Promise<PublicHistoryArchiveScanEvidence> =>
	fetchJson<PublicHistoryArchiveScanEvidence>(
		`/v1/archive-scans/${encodeURIComponent(historyUrl)}/evidence?limit=${encodeURIComponent(limit.toString())}`,
		withTags(options, [frontendCacheTags.historyScan])
	);

export const fetchHistoryArchiveObjects = (
	limit: number,
	options?: FetchOptions
): Promise<PublicHistoryArchiveObjectQueue> =>
	fetchJson<PublicHistoryArchiveObjectQueue>(
		`/v1/archive-scans/objects?limit=${encodeURIComponent(limit.toString())}`,
		withTags(options, [frontendCacheTags.historyScan])
	);

export const fetchHistoryArchiveObjectSummary = (
	options?: FetchOptions
): Promise<PublicHistoryArchiveObjectSummary> =>
	fetchJson<PublicHistoryArchiveObjectSummary>(
		'/v1/archive-scans/objects/summary',
		withTags(options, [frontendCacheTags.historyScan])
	);

export const fetchHistoryArchiveObjectsForArchive = (
	historyUrl: string,
	limit: number,
	options?: FetchOptions
): Promise<PublicHistoryArchiveObjectQueue> =>
	fetchJson<PublicHistoryArchiveObjectQueue>(
		`/v1/archive-scans/${encodeURIComponent(historyUrl)}/objects?limit=${encodeURIComponent(limit.toString())}`,
		withTags(options, [frontendCacheTags.historyScan])
	);

export const fetchHistoryArchiveObjectSummaryForArchive = (
	historyUrl: string,
	options?: FetchOptions
): Promise<PublicHistoryArchiveObjectSummary> =>
	fetchJson<PublicHistoryArchiveObjectSummary>(
		`/v1/archive-scans/${encodeURIComponent(historyUrl)}/objects/summary`,
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

export const fetchExplorerRecentTransactions = (
	limit: number,
	options?: FetchOptions
): Promise<PublicRecentTransactions> =>
	fetchJson<PublicRecentTransactions>(
		`/v1/explorer/transactions?limit=${encodeURIComponent(limit.toString())}`,
		options
	);

export const fetchExplorerLedger = (
	sequence: string,
	options?: FetchOptions
): Promise<PublicExplorerLedger> =>
	fetchJson<PublicExplorerLedger>(
		`/v1/explorer/ledgers/${encodeURIComponent(sequence)}`,
		options
	);

export const fetchExplorerAccountObservations = (
	accountId: string,
	options?: FetchOptions
): Promise<PublicExplorerLocalAccountChanges> =>
	fetchValidatedJson(
		`/v1/explorer/accounts/${encodeURIComponent(accountId)}/observations`,
		parseExplorerLocalAccountChanges,
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
	if (filters.firstLedger) params.set('firstLedger', filters.firstLedger);
	if (filters.from) params.set('from', filters.from);
	if (filters.ledger) params.set('ledger', filters.ledger);
	if (filters.lastLedger) params.set('lastLedger', filters.lastLedger);
	if (filters.operationType) params.set('operationType', filters.operationType);
	if (filters.to) params.set('to', filters.to);
	if (filters.transactionHash)
		params.set('transactionHash', filters.transactionHash);
	const query = params.toString();
	return fetchJson<PublicExplorerOperations>(
		`/v1/explorer/operations${query.length > 0 ? `?${query}` : ''}`,
		options
	);
};

export const fetchExplorerTransactionOperations = (
	hash: string,
	options?: FetchOptions
): Promise<PublicExplorerOperations> =>
	fetchJson<PublicExplorerOperations>(
		`/v1/explorer/transactions/${encodeURIComponent(hash)}/operations`,
		options
	);

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

export const fetchScpEvidenceSlots = async (
	limit = 12,
	options?: FetchOptions
) => {
	const payload = await fetchJson<unknown>(
		`/v1/scp/evidence/slots?limit=${encodeURIComponent(limit.toString())}`,
		withTags(options, [frontendCacheTags.scpStatements])
	);
	const { parseScpLatestSlots } = await import('./scp-evidence');
	const parsed = parseScpLatestSlots(payload);
	if (parsed === null)
		throw new Error('SCP evidence response failed validation');
	return parsed;
};

export const fetchScpAnimationBacklog = async (
	limit = 4,
	options?: FetchOptions
) => {
	const payload = await fetchJson<unknown>(
		`/v1/scp/evidence/animation-backlog?limit=${encodeURIComponent(limit.toString())}`,
		withTags(options, [frontendCacheTags.scpStatements])
	);
	const { parseScpAnimationBacklog } = await import('./scp-evidence');
	const parsed = parseScpAnimationBacklog(payload);
	if (parsed === null)
		throw new Error('SCP animation backlog response failed validation');
	return parsed;
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

export const fetchScanLogStatus = (
	options?: FetchOptions
): Promise<PublicScanLogStatus> =>
	fetchJson<PublicScanLogStatus>(
		'/v1/status/scan-logs',
		withTags(options, [frontendCacheTags.status])
	);

export const fetchWorkerStatus = async (
	options?: FetchOptions
): Promise<PublicWorkerStatus> => {
	const value = await fetchJson<unknown>(
		'/v1/status/workers',
		withTags(options, [frontendCacheTags.status])
	);
	const parsed = parseWorkerStatusDTO(value);
	if (parsed === null) {
		throw new ApiClientError({ message: 'Worker status response was invalid' });
	}
	return parsed;
};

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

export const fetchFullHistoryStatus = (
	options?: FetchOptions
): Promise<PublicFullHistoryStatus> =>
	fetchValidatedJson(
		'/v1/status/full-history',
		parseFullHistoryStatus,
		withTags(options, [frontendCacheTags.status])
	);

export const fetchFailoverStatus = (
	options?: FetchOptions
): Promise<PublicFailoverStatus> =>
	fetchJson<PublicFailoverStatus>(
		'/v1/status/failover',
		withTags(options, [frontendCacheTags.status])
	);
