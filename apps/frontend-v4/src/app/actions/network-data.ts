'use server';

import {
	fetchHistoryArchiveScanLogs,
	fetchLatestLedger,
	fetchLedgerTransactions
} from '../../api/client';
import type {
	PublicHistoryArchiveScanLogEntry,
	PublicLatestLedger,
	PublicLedgerTransactions
} from '../../api/types';

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
	return fetchLedgerTransactions(slotIndex, { cache: 'no-store' });
}
