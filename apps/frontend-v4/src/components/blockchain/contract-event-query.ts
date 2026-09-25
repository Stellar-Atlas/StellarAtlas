import type { ExplorerFilters } from '../../api/explorer-analytics';

export const contractEventExample = {
	contract_id: 'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA',
	min_ledger: '63490364',
	max_ledger: '63490364'
} satisfies ExplorerFilters;

export function contractEventQueryError(
	filters: ExplorerFilters
): string | null {
	if (!/^C[A-Z2-7]{55}$/.test(filters.contract_id?.trim() ?? ''))
		return 'Enter a contract address: C followed by 55 uppercase base32 characters.';
	for (const name of ['min_ledger', 'max_ledger']) {
		const value = filters[name]?.trim() ?? '';
		if (!/^[1-9][0-9]*$/.test(value) || Number(value) > 2147483647)
			return 'Enter whole ledger numbers between 1 and 2,147,483,647.';
	}
	const span = Number(filters.max_ledger) - Number(filters.min_ledger);
	if (span < 0)
		return 'The last ledger must be greater than or equal to the first ledger.';
	if (span >= 1000000) return 'Choose a window of at most 1,000,000 ledgers.';
	if (
		filters.transaction_hash &&
		!/^[a-fA-F0-9]{64}$/.test(filters.transaction_hash)
	)
		return 'A transaction hash must contain exactly 64 hexadecimal characters.';
	if (filters.type_code && !['0', '1', '2'].includes(filters.type_code))
		return 'Choose system, contract, diagnostic, or all event types.';
	for (const name of ['successful', 'in_successful_contract_call'])
		if (filters[name] && !['true', 'false'].includes(filters[name]))
			return 'Choose all, successful, or failed outcomes.';
	return null;
}

export function contractEventWorkspaceHref(filters: ExplorerFilters): string {
	const query = new URLSearchParams();
	for (const [name, value] of Object.entries(filters))
		if (value) query.set(name, value);
	return '/explorer/contract-events?' + query;
}
