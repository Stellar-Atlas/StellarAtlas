import type { HubbleWarehouse } from '../../../status/infrastructure/http/HubbleWarehouseContracts.js';
import type { ExplorerLiveTransactionFeed } from './GetExplorerRecentTransactions.js';

/** Read only published batches, with a bounded indexed tail rather than a full-history sort. */
export async function fetchParsedRecentTransactions(
	warehouse: Pick<HubbleWarehouse, 'catalog' | 'query'>,
	limit: number
): Promise<ExplorerLiveTransactionFeed> {
	if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RangeError('Invalid feed limit');
	const maximum = Number((await warehouse.catalog()).ingestion.maximumLedger ?? 0);
	if (maximum === 0) return { records: [], truncated: false };
	if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 2147483647) {
		throw new Error('Invalid parsed-history watermark');
	}
	const page = await warehouse.query({
		dataset: 'history_transactions',
		select: ['transaction_hash', 'ledger_sequence', 'closed_at', 'fee_charged', 'operation_count', 'account', 'successful'],
		filters: [
			{ field: '_ledger_sequence', operator: 'gte', value: Math.max(1, maximum - 2047) },
			{ field: '_ledger_sequence', operator: 'lte', value: maximum }
		],
		orderBy: [{ field: 'ledger_sequence', direction: 'desc' }, { field: 'id', direction: 'desc' }],
		limit: limit + 1
	});
	return { records: page.rows.slice(0, limit).map(mapTransaction), truncated: page.rows.length > limit };
}

function mapTransaction(row: Readonly<Record<string, unknown>>): ExplorerLiveTransactionFeed['records'][number] {
	const hash = row.transaction_hash;
	const account = row.account;
	const ledger = unsignedInteger(row.ledger_sequence, 2147483647);
	const fee = typeof row.fee_charged === 'string' ? row.fee_charged
		: unsignedInteger(row.fee_charged, Number.MAX_SAFE_INTEGER);
	const operations = Number(unsignedInteger(row.operation_count, 100));
	const date = typeof row.closed_at === 'string' ? row.closed_at : '';
	const timestamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(date)
		? date.replace(' ', 'T') + 'Z' : date;
	if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) ||
		typeof account !== 'string' || !/^(G[A-Z2-7]{55}|M[A-Z2-7]{68})$/.test(account) ||
		!/^\d+$/.test(ledger) || Number(ledger) < 1 || !/^\d+$/.test(fee) ||
		!Number.isSafeInteger(operations) || operations < 0 || operations > 100 ||
		typeof row.successful !== 'boolean' || !Number.isFinite(Date.parse(timestamp))) {
		throw new Error('Invalid parsed transaction record');
	}
	return { createdAt: new Date(timestamp).toISOString(), feeCharged: fee, hash, ledger,
		operationCount: operations, sourceAccount: account, successful: row.successful };
}

function unsignedInteger(value: unknown, maximum: number): string {
	if ((typeof value !== 'number' && typeof value !== 'string') ||
		(typeof value === 'string' && !/^\d+$/.test(value)) ||
		!Number.isSafeInteger(Number(value)) || Number(value) < 0 || Number(value) > maximum) {
		throw new Error('Invalid parsed transaction integer');
	}
	return String(value);
}
