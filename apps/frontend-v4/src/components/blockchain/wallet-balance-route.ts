type Query = Pick<URLSearchParams, 'get' | 'getAll'>;

export function validWalletCursor(value: string | null): value is string {
	return !!value && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value);
}

export function readWalletCursor(params: Query, account: string): string | null {
	if (params.getAll('wallet_for').length !== 1 || params.getAll('wallet_after').length !== 1 ||
		params.get('wallet_for') !== account) return null;
	const after = params.get('wallet_after');
	return validWalletCursor(after) ? after : null;
}

export function walletBalanceHref(pathname: string, search: string, account: string, after: string | null, fragment = ''): string {
	const params = new URLSearchParams(search);
	params.delete('wallet_for');
	params.delete('wallet_after');
	if (validWalletCursor(after)) {
		params.set('wallet_for', account);
		params.set('wallet_after', after);
	}
	return pathname + (params.size ? '?' + params.toString() : '') + fragment;
}
