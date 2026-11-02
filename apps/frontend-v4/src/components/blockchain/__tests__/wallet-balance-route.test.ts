import { readWalletCursor, walletBalanceHref } from '../wallet-balance-route';

describe('wallet balance cursor URLs', () => {
	it('restores exact opaque continuation only for its account', () => {
		const url = new URL(walletBalanceHref('/explorer/accounts/GA', '?after=event&return_to=%2Fexplorer', 'GA', 'opaque+/==', '#balances'), 'http://fixture.invalid');
		expect(readWalletCursor(url.searchParams, 'GA')).toBe('opaque+/==');
		expect(readWalletCursor(url.searchParams, 'GB')).toBeNull();
		expect(url.searchParams.get('after')).toBe('event');
		expect(url.searchParams.get('return_to')).toBe('/explorer');
		expect(url.hash).toBe('#balances');
	});
	it('rejects unbound, repeated, control-bearing and oversized cursors', () => {
		for (const query of ['wallet_after=c', 'wallet_for=GA&wallet_after=a&wallet_after=b', 'wallet_for=GA&wallet_for=GA&wallet_after=c', 'wallet_for=GA&wallet_after=%00c', 'wallet_for=GA&wallet_after=' + 'x'.repeat(4097)])
			expect(readWalletCursor(new URLSearchParams(query), 'GA')).toBeNull();
	});
	it('first-page navigation clears only wallet continuation', () => {
		const url = new URL(walletBalanceHref('/explorer/accounts/GA', '?wallet_for=GA&wallet_after=old&min_ledger=100&tab=balances', 'GA', null), 'http://fixture.invalid');
		expect(url.searchParams.has('wallet_after')).toBe(false);
		expect(url.searchParams.has('wallet_for')).toBe(false);
		expect(url.searchParams.get('min_ledger')).toBe('100');
		expect(url.searchParams.get('tab')).toBe('balances');
	});
});
