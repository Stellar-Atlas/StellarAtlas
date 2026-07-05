'use server';

import {
	fetchHistoryArchiveScanLogs,
	fetchLatestLedger,
	fetchLedgerTransactions,
	fetchTransactionByHash
} from '../../api/client';
import type {
	PublicHistoryArchiveScanLogEntry,
	PublicLatestLedger,
	PublicLedgerTransactions,
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
