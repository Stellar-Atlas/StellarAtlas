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
import { normalizeTransactionHash } from '../../domain/transaction-hash';

export type TransactionLookupStatus =
	'invalid' | 'not_found' | 'unavailable' | 'loaded';

export interface TransactionLookupResult {
	readonly message: string | null;
	readonly status: TransactionLookupStatus;
	readonly transaction: PublicTransactionLookup | null;
}

export type ExplorerActionStatus = 'invalid' | 'loaded' | 'unavailable';

export interface ExplorerSearchResult {
	readonly message: string | null;
	readonly search: PublicExplorerSearch | null;
	readonly status: ExplorerActionStatus;
}

export interface ExplorerOperationsResult {
	readonly message: string | null;
	readonly operations: PublicExplorerOperations | null;
	readonly status: ExplorerActionStatus;
}

export interface ExplorerAssetsResult {
	readonly assets: PublicExplorerAssets | null;
	readonly message: string | null;
	readonly status: ExplorerActionStatus;
}

export interface ExplorerContractResult {
	readonly contract: PublicExplorerContract | null;
	readonly message: string | null;
	readonly status: ExplorerActionStatus;
}

export interface ExplorerTransactionsResult {
	readonly message: string | null;
	readonly status: ExplorerActionStatus;
	readonly transactions: PublicRecentTransactions | null;
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
					? 'Transaction not found in configured Horizon'
					: 'Transaction lookup unavailable',
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
		return { message: 'Enter a search value', search: null, status: 'invalid' };
	}

	try {
		return {
			message: null,
			search: await fetchExplorerSearch(normalizedQuery, type, {
				cache: 'no-store'
			}),
			status: 'loaded'
		};
	} catch {
		return {
			message: 'Explorer search unavailable',
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
			operations: null,
			status: 'invalid'
		};
	}

	try {
		return {
			message: null,
			operations: await fetchExplorerTransactionOperations(normalizedHash, {
				cache: 'no-store'
			}),
			status: 'loaded'
		};
	} catch {
		return {
			message: 'Transaction operations unavailable',
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

export async function searchExplorerOperations(
	filters: PublicExplorerOperationFilters
): Promise<ExplorerOperationsResult> {
	try {
		return {
			message: null,
			operations: await fetchExplorerOperations(filters, { cache: 'no-store' }),
			status: 'loaded'
		};
	} catch {
		return {
			message: 'Operation search unavailable',
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
			status: 'loaded'
		};
	} catch {
		return {
			assets: null,
			message: 'Asset search unavailable',
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
			status: 'invalid'
		};
	}

	try {
		return {
			contract: await fetchExplorerContract(normalizedContractId, {
				cache: 'no-store'
			}),
			message: null,
			status: 'loaded'
		};
	} catch {
		return {
			contract: null,
			message: 'Contract lookup unavailable',
			status: 'unavailable'
		};
	}
}
