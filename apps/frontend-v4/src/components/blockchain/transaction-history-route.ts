import { validLedgerSequence } from '../../api/explorer-ledger-transactions';

type LedgerPage = { readonly ledger: string; readonly offset: number };
export type TransactionHistorySelection =
	| { readonly mode: 'recent' | 'invalid' }
	| ({ readonly mode: 'ledger' } & LedgerPage);

function validPage(page: LedgerPage): boolean {
	return validLedgerSequence(page.ledger) && Number.isSafeInteger(page.offset) &&
		page.offset >= 0 && page.offset <= 10000 && page.offset % 25 === 0;
}

export function readTransactionHistory(params: Pick<URLSearchParams, 'getAll'>): TransactionHistorySelection {
	const ledger = params.getAll('tx_ledger'), offset = params.getAll('tx_offset');
	if (!ledger.length && !offset.length) return { mode: 'recent' };
	const value = offset[0] ?? '0';
	if (ledger.length !== 1 || offset.length > 1 || !/^(0|[1-9]\d{0,4})$/.test(value))
		return { mode: 'invalid' };
	const page = { ledger: ledger[0]!, offset: Number(value) };
	return validPage(page) ? { mode: 'ledger', ...page } : { mode: 'invalid' };
}

export function transactionHistoryHref(search: string, page: LedgerPage | null, fragment = ''): string {
	const params = new URLSearchParams(search);
	params.delete('tx_ledger');
	params.delete('tx_offset');
	if (page !== null) {
		if (!validPage(page)) throw new Error('Invalid transaction history selection.');
		params.set('tx_ledger', page.ledger);
		if (page.offset > 0) params.set('tx_offset', String(page.offset));
	}
	return '/explorer' + (params.size ? '?' + params : '') + fragment;
}
