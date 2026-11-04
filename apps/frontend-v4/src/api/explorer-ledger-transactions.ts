import type { PublicRecentTransactions } from './types';
import { normalizeWarehouseTimestamp, recordValue } from './explorer-analytics';

export interface LedgerTransactionPage {
	readonly records: PublicRecentTransactions['records'];
	readonly limit: number;
	readonly offset: number;
	readonly nextOffset: number | null;
}
export function validLedgerSequence(value: string): boolean {
	return /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 4294967295;
}
export function buildLedgerTransactionsPath(ledger: string, offset: number): string {
	if (!validLedgerSequence(ledger) || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000) throw new Error('Invalid ledger transaction selection.');
	const query = new URLSearchParams({ ledger_sequence: ledger, select: 'transaction_hash,ledger_sequence,account,fee_charged,operation_count,successful,closed_at', order: 'id', limit: '25', offset: String(offset) });
	return '/v1/datasets/history_transactions/records?' + query;
}
function invalid(): never { throw new Error('The data service returned invalid ledger transaction records.'); }
export function parseLedgerTransactions(ledger: string, offset: number, value: unknown): LedgerTransactionPage {
	const data = recordValue(value);
	if (data.dataset !== 'history_transactions' || data.limit !== 25 || data.offset !== offset || !Array.isArray(data.rows) || data.rows.length > 25) invalid();
	const records = data.rows.map((value) => {
		const row = recordValue(value);
		const hash = row.transaction_hash;
		const fee = row.fee_charged;
		const feeCharged = typeof fee === 'string' && /^\d+$/.test(fee) ? fee : typeof fee === 'number' && Number.isSafeInteger(fee) && fee >= 0 ? String(fee) : invalid();
		const closedAt = typeof row.closed_at === 'string' ? normalizeWarehouseTimestamp(row.closed_at) : invalid();
		if (typeof hash !== 'string' || !/^[a-f\d]{64}$/i.test(hash) || String(row.ledger_sequence) !== ledger || typeof row.account !== 'string' || !row.account || typeof row.successful !== 'boolean' || typeof row.operation_count !== 'number' || !Number.isSafeInteger(row.operation_count) || row.operation_count < 0 || !Number.isFinite(Date.parse(closedAt))) invalid();
		return { hash, ledger, createdAt: closedAt, sourceAccount: row.account, successful: row.successful, operationCount: row.operation_count, feeCharged };
	});
	const nextOffset = data.nextOffset === undefined ? null : data.nextOffset;
	if (nextOffset !== null && nextOffset !== offset + 25) invalid();
	return { records, limit: 25, offset, nextOffset };
}
