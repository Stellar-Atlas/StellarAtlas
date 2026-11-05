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
