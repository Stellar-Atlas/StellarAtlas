'use server';

import {
	fetchHistoryArchiveScanLogs,
	fetchExplorerAssets,
	fetchExplorerContract,
	fetchExplorerOperations,
	fetchExplorerRecentTransactions,
	fetchExplorerSearch,
	fetchExplorerTransactionOperations,
	fetchLatestLedger,
	fetchLedgerTransactions,
	fetchTransactionByHash
} from '../../api/client';
import { fetchExplorerLocalReadModel } from '../../api/explorer-client';
import type {
	PublicExplorerAssets,
	PublicExplorerContract,
	PublicExplorerOperationFilters,
	PublicExplorerOperations,
	PublicExplorerSearch,
	PublicExplorerSearchType,
	PublicHistoryArchiveScanLogEntry,
	PublicLatestLedger,
	PublicLedgerTransactions,
	PublicRecentTransactions,
	PublicTransactionLookup
} from '../../api/types';
import type { PublicExplorerLocalReadModel } from '../../api/explorer-types';
import { normalizeTransactionHash } from '../../domain/transaction-hash';

export type TransactionLookupStatus =
	'invalid' | 'not_found' | 'unavailable' | 'loaded';

export interface TransactionLookupResult {
	readonly message: string | null;
	readonly observedAt: string | null;
	readonly status: TransactionLookupStatus;
	readonly transaction: PublicTransactionLookup | null;
}

export type ExplorerActionStatus = 'invalid' | 'loaded' | 'unavailable';

export interface ExplorerSearchResult {
	readonly message: string | null;
	readonly observedAt: string | null;
	readonly search: PublicExplorerSearch | null;
	readonly status: ExplorerActionStatus;
}

export interface ExplorerOperationsResult {
	readonly message: string | null;
	readonly observedAt: string | null;
	readonly operations: PublicExplorerOperations | null;
	readonly status: ExplorerActionStatus;
}

export interface ExplorerAssetsResult {
	readonly assets: PublicExplorerAssets | null;
	readonly message: string | null;
	readonly observedAt: string | null;
	readonly status: ExplorerActionStatus;
}

export interface ExplorerContractResult {
	readonly contract: PublicExplorerContract | null;
	readonly message: string | null;
	readonly observedAt: string | null;
	readonly status: ExplorerActionStatus;
}

export interface ExplorerTransactionsResult {
	readonly message: string | null;
	readonly status: ExplorerActionStatus;
	readonly transactions: PublicRecentTransactions | null;
}

export interface ExplorerLocalReadModelResult {
	readonly message: string | null;
	readonly readModel: PublicExplorerLocalReadModel | null;
	readonly status: ExplorerActionStatus;
}

export interface ExplorerInitialDataResult {
	readonly readModel: ExplorerLocalReadModelResult;
	readonly transactions: ExplorerTransactionsResult;
}

export async function getHistoryArchiveScanLogs(
	historyUrl: string
): Promise<PublicHistoryArchiveScanLogEntry[]> {
	return fetchHistoryArchiveScanLogs(historyUrl, { cache: 'no-store' });
}

export async function getLatestLedger(): Promise<PublicLatestLedger> {
	return fetchLatestLedger({ cache: 'no-store' });
}

export async function getLedgerTransactions(
	slotIndex: string
): Promise<PublicLedgerTransactions> {
	try {
		return await fetchLedgerTransactions(slotIndex, { cache: 'no-store' });
	} catch {
		return {
			ledger: slotIndex,
			records: [],
			truncated: false
		};
	}
}

export async function lookupTransactionByHash(
	hash: string
): Promise<TransactionLookupResult> {
	const normalizedHash = normalizeTransactionHash(hash);
	if (!normalizedHash) {
		return {
			message: 'Invalid transaction hash',
			observedAt: null,
			status: 'invalid',
			transaction: null
		};
	}

	try {
		const transaction = await fetchTransactionByHash(normalizedHash, {
			cache: 'no-store'
		});
		return {
			message: null,
			observedAt: new Date().toISOString(),
			status: 'loaded',
			transaction
		};
	} catch (error) {
		const statusCode =
			error instanceof Error && 'statusCode' in error
				? (error.statusCode as number | undefined)
				: undefined;
		return {
			message:
				statusCode === 404
					? 'Transaction not found'
					: 'Transaction lookup unavailable',
			observedAt: null,
			status: statusCode === 404 ? 'not_found' : 'unavailable',
			transaction: null
		};
	}
}

export async function searchExplorer(
	query: string,
	type: PublicExplorerSearchType
): Promise<ExplorerSearchResult> {
	const normalizedQuery = query.trim();
	if (normalizedQuery.length === 0) {
		return {
			message: 'Enter a search value',
			observedAt: null,
			search: null,
			status: 'invalid'
		};
	}

	try {
		return {
			message: null,
			observedAt: new Date().toISOString(),
			search: await fetchExplorerSearch(normalizedQuery, type, {
				cache: 'no-store'
			}),
			status: 'loaded'
		};
	} catch {
		return {
			message: 'Explorer search unavailable',
			observedAt: null,
			search: null,
			status: 'unavailable'
		};
	}
}

export async function getExplorerTransactionOperations(
	hash: string
): Promise<ExplorerOperationsResult> {
	const normalizedHash = normalizeTransactionHash(hash);
	if (!normalizedHash) {
		return {
			message: 'Invalid transaction hash',
			observedAt: null,
			operations: null,
			status: 'invalid'
		};
	}

	try {
		return {
			message: null,
			observedAt: new Date().toISOString(),
			operations: await fetchExplorerTransactionOperations(normalizedHash, {
				cache: 'no-store'
			}),
			status: 'loaded'
		};
	} catch {
		return {
			message: 'Transaction operations unavailable',
			observedAt: null,
			operations: null,
			status: 'unavailable'
		};
	}
}

export async function getExplorerRecentTransactions(
	limit = 20
): Promise<ExplorerTransactionsResult> {
	if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
		return {
			message: 'Invalid transaction feed limit',
			status: 'invalid',
			transactions: null
		};
	}

	try {
		return {
			message: null,
			status: 'loaded',
			transactions: await fetchExplorerRecentTransactions(limit, {
				cache: 'no-store'
			})
		};
	} catch {
		return {
			message: 'Transaction feed unavailable',
			status: 'unavailable',
			transactions: null
		};
	}
}

export async function getExplorerLocalReadModel(): Promise<ExplorerLocalReadModelResult> {
	try {
		return {
			message: null,
			readModel: await fetchExplorerLocalReadModel({ cache: 'no-store' }),
			status: 'loaded'
		};
	} catch {
		return {
			message: 'Explorer status unavailable',
			readModel: null,
			status: 'unavailable'
		};
	}
}

export async function getExplorerInitialData(
	limit = 20
): Promise<ExplorerInitialDataResult> {
	const [readModel, transactions] = await Promise.all([
		getExplorerLocalReadModel(),
		getExplorerRecentTransactions(limit)
	]);
	return { readModel, transactions };
}

export async function searchExplorerOperations(
	filters: PublicExplorerOperationFilters
): Promise<ExplorerOperationsResult> {
	try {
		return {
			message: null,
			observedAt: new Date().toISOString(),
			operations: await fetchExplorerOperations(filters, { cache: 'no-store' }),
			status: 'loaded'
		};
	} catch {
		return {
			message: 'Operation search unavailable',
			observedAt: null,
			operations: null,
			status: 'unavailable'
		};
	}
}

export async function searchExplorerAssets(
	assetCode: string,
	assetIssuer: string
): Promise<ExplorerAssetsResult> {
	try {
		return {
			assets: await fetchExplorerAssets(assetCode, assetIssuer, {
				cache: 'no-store'
			}),
			message: null,
			observedAt: new Date().toISOString(),
			status: 'loaded'
		};
	} catch {
		return {
			assets: null,
			message: 'Asset search unavailable',
			observedAt: null,
			status: 'unavailable'
		};
	}
}

export async function lookupExplorerContract(
	contractId: string
): Promise<ExplorerContractResult> {
	const normalizedContractId = contractId.trim();
	if (normalizedContractId.length === 0) {
		return {
			contract: null,
			message: 'Enter a contract id',
			observedAt: null,
			status: 'invalid'
		};
	}

	try {
		return {
			contract: await fetchExplorerContract(normalizedContractId, {
				cache: 'no-store'
			}),
			message: null,
			observedAt: new Date().toISOString(),
			status: 'loaded'
		};
	} catch {
		return {
			contract: null,
			message: 'Contract lookup unavailable',
			observedAt: null,
			status: 'unavailable'
		};
	}
}
