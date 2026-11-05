export type TransactionPageResult = 'all' | 'successful' | 'failed';

export function readTransactionPageResult(params: Pick<URLSearchParams, 'getAll'>): TransactionPageResult {
	const values = params.getAll('tx_result');
	return values.length === 1 && (values[0] === 'successful' || values[0] === 'failed') ? values[0] : 'all';
}

export function transactionPageResultQuery(search: string, result: TransactionPageResult): string {
	const params = new URLSearchParams(search);
	params.delete('tx_result');
	if (result !== 'all') params.set('tx_result', result);
	return params.size ? '?' + params : '';
}

export const TRANSACTION_MATCH_LIMIT = 64;

export function normalizeTransactionMatch(value: string): string | null {
	const match = value.trim();
	return match === '' || /^[a-z0-9]{1,64}$/i.test(match) ? match.toLowerCase() : null;
}

export function readTransactionMatch(params: Pick<URLSearchParams, 'getAll'> | null): string {
	const values = params?.getAll('tx_match');
	return values?.length === 1 ? normalizeTransactionMatch(values[0] ?? '') ?? '' : '';
}

export function transactionMatchQuery(search: string, value: string): string | null {
	const match = normalizeTransactionMatch(value);
	if (match === null) return null;
	const params = new URLSearchParams(search);
	params.delete('tx_match');
	if (match) params.set('tx_match', match);
	return params.size ? '?' + params : '';
}
