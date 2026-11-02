import { buildEntityHref } from '../../api/explorer-analytics';
import { validLedgerSequence } from '../../api/explorer-ledger-transactions';
type Query = Pick<URLSearchParams, 'get' | 'getAll'>;
export function readLedgerActivity(params: Query, ledger: string): { open: boolean; offset: number } {
	const open = params.get('ledger_view') === 'transactions' && params.getAll('ledger_view').length === 1;
	const value = params.get('ledger_tx_offset') ?? '0';
	const bound = params.get('ledger_tx_for') === ledger && params.getAll('ledger_tx_for').length === 1;
	return { open, offset: open && bound && params.getAll('ledger_tx_offset').length <= 1 && /^(0|[1-9]\d{0,4})$/.test(value) && Number(value) <= 10000 ? Number(value) : 0 };
}
export function ledgerActivityHref(pathname: string, search: string, ledger: string, open: boolean, offset = 0, fragment = ''): string {
	const params = new URLSearchParams(search);
	for (const key of ['ledger_view', 'ledger_tx_offset', 'ledger_tx_for']) params.delete(key);
	if (open) params.set('ledger_view', 'transactions');
	if (open && Number.isSafeInteger(offset) && offset > 0 && offset <= 10000) { params.set('ledger_tx_offset', String(offset)); params.set('ledger_tx_for', ledger); }
	return pathname + (params.size ? '?' + params.toString() : '') + fragment;
}
export function adjacentLedgerHref(ledger: string, delta: -1 | 1): string | null {
	if (!validLedgerSequence(ledger)) return null;
	const target = BigInt(ledger) + BigInt(delta);
	return target >= 1n && target <= 4294967295n ? buildEntityHref('ledgers', String(target)) : null;
}
