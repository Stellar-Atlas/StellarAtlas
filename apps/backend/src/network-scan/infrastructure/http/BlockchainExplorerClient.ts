import {
	fetchTransactionByHash,
	type TransactionLookupDTO
} from './HorizonLedgerClient.js';

export type ExplorerSearchType =
	'auto' | 'account' | 'asset' | 'contract' | 'ledger' | 'transaction';

export interface ExplorerLedgerDTO {
	readonly closedAt: string;
	readonly hash: string;
	readonly operationCount: number;
	readonly protocolVersion: number;
	readonly sequence: string;
	readonly source: 'horizon';
	readonly transactionCount: number | null;
}

export interface ExplorerAccountBalanceDTO {
	readonly assetCode: string | null;
	readonly assetIssuer: string | null;
	readonly assetType: string;
	readonly balance: string;
}

export interface ExplorerAccountDTO {
	readonly accountId: string;
	readonly balances: readonly ExplorerAccountBalanceDTO[];
	readonly lastModifiedLedger: string | null;
	readonly sequence: string;
	readonly source: 'horizon';
	readonly subentryCount: number;
}

export interface ExplorerAssetDTO {
	readonly amount: string | null;
	readonly assetCode: string | null;
	readonly assetIssuer: string | null;
	readonly assetType: string;
	readonly numAccounts: number | null;
	readonly source: 'horizon';
}

export interface ExplorerOperationDTO {
	readonly createdAt: string;
	readonly id: string;
	readonly ledger: string | null;
	readonly source: 'horizon';
	readonly sourceAccount: string | null;
	readonly successful: boolean | null;
	readonly transactionHash: string | null;
	readonly type: string;
	readonly typeNumber: number | null;
}

export interface ExplorerOperationsDTO {
	readonly filters: ExplorerOperationFilters;
	readonly records: readonly ExplorerOperationDTO[];
	readonly source: 'horizon';
	readonly truncated: boolean;
}

export interface ExplorerOperationFilters {
	readonly accountId?: string;
	readonly from?: string;
	readonly ledger?: string;
	readonly operationType?: string;
	readonly to?: string;
}

export interface ExplorerAssetsDTO {
	readonly assets: readonly ExplorerAssetDTO[];
	readonly source: 'horizon';
	readonly truncated: boolean;
}

export interface ExplorerContractDTO {
	readonly contractId: string;
	readonly message: string;
	readonly source: 'rpc';
	readonly status: 'loaded' | 'unavailable' | 'unconfigured';
}

export interface ExplorerSearchDTO {
	readonly query: string;
	readonly result:
		| ExplorerAccountDTO
		| ExplorerAssetsDTO
		| ExplorerContractDTO
		| ExplorerLedgerDTO
		| ExplorerOperationDTO
		| TransactionLookupDTO
		| null;
	readonly resultType:
		| 'account'
		| 'asset'
		| 'contract'
		| 'ledger'
		| 'not_found'
		| 'transaction'
		| 'unknown';
	readonly source: 'horizon' | 'rpc';
}

interface HorizonLedgerRecord {
	closed_at?: string;
	hash?: string;
	operation_count?: number;
	protocol_version?: number;
	sequence?: number;
	transaction_count?: number;
}

interface HorizonAccountRecord {
	account_id?: string;
	balances?: HorizonBalanceRecord[];
	id?: string;
	last_modified_ledger?: number;
	sequence?: string;
	subentry_count?: number;
}

interface HorizonBalanceRecord {
	asset_code?: string;
	asset_issuer?: string;
	asset_type?: string;
	balance?: string;
}

interface HorizonAssetRecord {
	amount?: string;
	asset_code?: string;
	asset_issuer?: string;
	asset_type?: string;
	num_accounts?: number;
}

interface HorizonOperationRecord {
	created_at?: string;
	id?: string;
	ledger?: number;
	source_account?: string;
	transaction_hash?: string;
	transaction_successful?: boolean;
	type?: string;
	type_i?: number;
}

interface HorizonRecordsResponse<RecordType> {
	_embedded?: {
		records?: RecordType[];
	};
	_links?: {
		next?: {
			href?: string;
		};
	};
}

const horizonLimit = 200;
const maxFetchedRecords = 600;

const transactionHashPattern = /^[a-f0-9]{64}$/i;
const ledgerSequencePattern = /^\d+$/;
const accountAddressPattern = /^[GM][A-Z2-7]{55,68}$/;
const contractAddressPattern = /^C[A-Z2-7]{55}$/;
const assetQueryPattern = /^([A-Za-z0-9]{1,12})(?::([A-Z2-7]{56}))?$/;

const getBaseUrl = (horizonUrl: string): string =>
	horizonUrl.endsWith('/') ? horizonUrl : `${horizonUrl}/`;

export const isTransactionHash = (value: string): boolean =>
	transactionHashPattern.test(value.trim());

export const isLedgerSequence = (value: string): boolean =>
	ledgerSequencePattern.test(value.trim());

export const isAccountAddress = (value: string): boolean =>
	accountAddressPattern.test(value.trim());

export const isContractAddress = (value: string): boolean =>
	contractAddressPattern.test(value.trim());

export const fetchExplorerLedger = async (
	horizonUrl: string,
	sequence: string
): Promise<ExplorerLedgerDTO | null> => {
	const response = await fetch(
		new URL(`ledgers/${sequence}`, getBaseUrl(horizonUrl)),
		{
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(8_000)
		}
	);
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Horizon returned HTTP ${response.status}`);

	const record = (await response.json()) as HorizonLedgerRecord;
	return mapLedger(record);
};

export const fetchExplorerAccount = async (
	horizonUrl: string,
	accountId: string
): Promise<ExplorerAccountDTO | null> => {
	const response = await fetch(
		new URL(`accounts/${accountId}`, getBaseUrl(horizonUrl)),
		{
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(8_000)
		}
	);
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Horizon returned HTTP ${response.status}`);

	const record = (await response.json()) as HorizonAccountRecord;
	return mapAccount(record);
};

export const fetchExplorerAssets = async (
	horizonUrl: string,
	assetCode?: string,
	assetIssuer?: string
): Promise<ExplorerAssetsDTO> => {
	const url = new URL('assets', getBaseUrl(horizonUrl));
	url.searchParams.set('limit', horizonLimit.toString());
	url.searchParams.set('order', 'desc');
	if (assetCode) url.searchParams.set('asset_code', assetCode);
	if (assetIssuer) url.searchParams.set('asset_issuer', assetIssuer);

	const payload = await fetchHorizonPage<HorizonAssetRecord>(url.toString());
	return {
		assets: payload.records.map(mapAsset),
		source: 'horizon',
		truncated: payload.truncated
	};
};

export const fetchExplorerOperations = async (
	horizonUrl: string,
	filters: ExplorerOperationFilters
): Promise<ExplorerOperationsDTO> => {
	const url = buildOperationsUrl(horizonUrl, filters);
	const payload = await fetchHorizonPage<HorizonOperationRecord>(url);
	const records = payload.records
		.map(mapOperation)
		.map((operation) =>
			filters.ledger && operation.ledger === null
				? { ...operation, ledger: filters.ledger }
				: operation
		)
		.filter((operation) => {
			if (filters.operationType && operation.type !== filters.operationType)
				return false;
			return inDateRange(operation.createdAt, filters.from, filters.to);
		});

	return {
		filters,
		records,
		source: 'horizon',
		truncated: payload.truncated
	};
};

export const fetchExplorerSearch = async (
	horizonUrl: string,
	rpcUrl: string | undefined,
	query: string,
	searchType: ExplorerSearchType
): Promise<ExplorerSearchDTO> => {
	const normalizedQuery = query.trim();
	const type =
		searchType === 'auto' ? inferSearchType(normalizedQuery) : searchType;

	if (type === 'transaction' && isTransactionHash(normalizedQuery)) {
		const result = await fetchTransactionByHash(horizonUrl, normalizedQuery);
		return {
			query: normalizedQuery,
			result,
			resultType: result ? 'transaction' : 'not_found',
			source: 'horizon'
		};
	}
	if (type === 'ledger' && isLedgerSequence(normalizedQuery)) {
		const result = await fetchExplorerLedger(horizonUrl, normalizedQuery);
		return {
			query: normalizedQuery,
			result,
			resultType: result ? 'ledger' : 'not_found',
			source: 'horizon'
		};
	}
	if (type === 'account' && isAccountAddress(normalizedQuery)) {
		const result = await fetchExplorerAccount(horizonUrl, normalizedQuery);
		return {
			query: normalizedQuery,
			result,
			resultType: result ? 'account' : 'not_found',
			source: 'horizon'
		};
	}
	if (type === 'contract' && isContractAddress(normalizedQuery)) {
		return {
			query: normalizedQuery,
			result: mapContractStatus(normalizedQuery, rpcUrl),
			resultType: 'contract',
			source: 'rpc'
		};
	}
	if (type === 'asset') {
		const assetMatch = assetQueryPattern.exec(normalizedQuery);
		const result = await fetchExplorerAssets(
			horizonUrl,
			assetMatch?.[1],
			assetMatch?.[2]
		);
		return {
			query: normalizedQuery,
			result,
			resultType: 'asset',
			source: 'horizon'
		};
	}

	return {
		query: normalizedQuery,
		result: null,
		resultType: 'unknown',
		source: 'horizon'
	};
};

function buildOperationsUrl(
	horizonUrl: string,
	filters: ExplorerOperationFilters
): string {
	const path = filters.ledger
		? `ledgers/${filters.ledger}/operations`
		: filters.accountId
			? `accounts/${filters.accountId}/operations`
			: 'operations';
	const url = new URL(path, getBaseUrl(horizonUrl));
	url.searchParams.set('limit', horizonLimit.toString());
	url.searchParams.set('order', 'desc');
	return url.toString();
}

async function fetchHorizonPage<RecordType>(firstUrl: string): Promise<{
	readonly records: readonly RecordType[];
	readonly truncated: boolean;
}> {
	const records: RecordType[] = [];
	let nextUrl: string | null = firstUrl;

	while (nextUrl && records.length < maxFetchedRecords) {
		const response = await fetch(nextUrl, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(12_000)
		});
		if (!response.ok)
			throw new Error(`Horizon returned HTTP ${response.status}`);

		const payload =
			(await response.json()) as HorizonRecordsResponse<RecordType>;
		const pageRecords = payload._embedded?.records ?? [];
		records.push(...pageRecords);
		nextUrl =
			pageRecords.length > 0 && records.length < maxFetchedRecords
				? (payload._links?.next?.href ?? null)
				: null;
	}

	return {
		records: records.slice(0, maxFetchedRecords),
		truncated: nextUrl !== null
	};
}

function inferSearchType(query: string): ExplorerSearchType {
	if (isTransactionHash(query)) return 'transaction';
	if (isLedgerSequence(query)) return 'ledger';
	if (isContractAddress(query)) return 'contract';
	if (isAccountAddress(query)) return 'account';
	if (assetQueryPattern.test(query)) return 'asset';
	return 'auto';
}

function mapLedger(record: HorizonLedgerRecord): ExplorerLedgerDTO {
	if (
		typeof record.closed_at !== 'string' ||
		typeof record.hash !== 'string' ||
		typeof record.operation_count !== 'number' ||
		typeof record.protocol_version !== 'number' ||
		typeof record.sequence !== 'number'
	) {
		throw new Error('Ledger record missing from Horizon response');
	}
	return {
		closedAt: record.closed_at,
		hash: record.hash,
		operationCount: record.operation_count,
		protocolVersion: record.protocol_version,
		sequence: record.sequence.toString(),
		source: 'horizon',
		transactionCount: record.transaction_count ?? null
	};
}

function mapAccount(record: HorizonAccountRecord): ExplorerAccountDTO {
	const accountId = record.account_id ?? record.id;
	if (
		typeof accountId !== 'string' ||
		typeof record.sequence !== 'string' ||
		typeof record.subentry_count !== 'number'
	) {
		throw new Error('Account record missing from Horizon response');
	}
	return {
		accountId,
		balances: (record.balances ?? []).map(mapBalance),
		lastModifiedLedger:
			typeof record.last_modified_ledger === 'number'
				? record.last_modified_ledger.toString()
				: null,
		sequence: record.sequence,
		source: 'horizon',
		subentryCount: record.subentry_count
	};
}

function mapBalance(record: HorizonBalanceRecord): ExplorerAccountBalanceDTO {
	return {
		assetCode: record.asset_code ?? null,
		assetIssuer: record.asset_issuer ?? null,
		assetType: record.asset_type ?? 'unknown',
		balance: record.balance ?? '0'
	};
}

function mapAsset(record: HorizonAssetRecord): ExplorerAssetDTO {
	return {
		amount: record.amount ?? null,
		assetCode: record.asset_code ?? null,
		assetIssuer: record.asset_issuer ?? null,
		assetType: record.asset_type ?? 'unknown',
		numAccounts: record.num_accounts ?? null,
		source: 'horizon'
	};
}

function mapOperation(record: HorizonOperationRecord): ExplorerOperationDTO {
	return {
		createdAt: record.created_at ?? '',
		id: record.id ?? '',
		ledger: typeof record.ledger === 'number' ? record.ledger.toString() : null,
		source: 'horizon',
		sourceAccount: record.source_account ?? null,
		successful: record.transaction_successful ?? null,
		transactionHash: record.transaction_hash ?? null,
		type: record.type ?? 'unknown',
		typeNumber: record.type_i ?? null
	};
}

function mapContractStatus(
	contractId: string,
	rpcUrl: string | undefined
): ExplorerContractDTO {
	return {
		contractId,
		message: rpcUrl
			? 'Contract indexing is waiting for the local RPC read path.'
			: 'Stellar RPC is not configured on this host yet.',
		source: 'rpc',
		status: rpcUrl ? 'unavailable' : 'unconfigured'
	};
}

function inDateRange(createdAt: string, from?: string, to?: string): boolean {
	const time = Date.parse(createdAt);
	if (!Number.isFinite(time)) return true;
	if (from && time < Date.parse(from)) return false;
	if (to && time > Date.parse(to)) return false;
	return true;
}
