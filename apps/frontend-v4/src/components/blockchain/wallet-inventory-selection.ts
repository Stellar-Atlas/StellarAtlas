import type { CurrentBalance } from '../../api/explorer-current-account';

export type WalletInventoryOrder = 'asset' | 'balance-desc' | 'balance-asc';
/** Only the already bounded account response; never a historical holder dataset. */
export function selectWalletInventory(
	balances: readonly CurrentBalance[],
	view: 'assets' | 'trustlines',
	query: string,
	order: WalletInventoryOrder
): readonly CurrentBalance[] {
	const needle = query.trim().toLowerCase();
	const rank = (row: CurrentBalance) => row.kind === 'native' ? 0 : row.kind === 'credit' ? 1 : 2;
	const matches = (row: CurrentBalance): boolean => !needle || (row.kind === 'credit'
		// A short code must not match unrelated assets through an issuer suffix.
		? row.code.toLowerCase().includes(needle) || row.issuer.toLowerCase() === needle || row.id.toLowerCase() === needle
		: (row.kind === 'native' ? 'xlm native' : 'liquidity pool shares ' + row.id).toLowerCase().includes(needle));
	return balances.filter(row => (view === 'trustlines' ? row.kind !== 'native' : row.kind === 'native' || row.balance > 0n) && matches(row))
		.sort((a, b) => {
			if (order !== 'asset' && a.balance !== b.balance) {
				const comparison = a.balance < b.balance ? -1 : 1;
				return order === 'balance-desc' ? -comparison : comparison;
			}
			return rank(a) - rank(b) || a.id.localeCompare(b.id);
		});
}
