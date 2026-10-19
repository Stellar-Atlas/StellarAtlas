import type { ExplorerFilters } from '../../api/explorer-analytics';

export const contractEventExample = {
	contract_id: 'CA526Y2NQWGWVVQ7RFFPGAZMU66PSYJ3UC2MTVAV4ZU7OM5BOPHDXUSG',
	min_ledger: '64877635',
	max_ledger: '64877698',
	limit: '10'
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
	if (
		filters.topic &&
		(filters.topic.trim().length > 128 ||
			/[\u0000-\u001f\u007f]/.test(filters.topic))
	)
		return 'Use a topic of at most 128 characters without control characters.';
	if (filters.order && !['asc', 'desc'].includes(filters.order))
		return 'Choose newest or oldest events first.';
	if (filters.limit && !['10', '25', '50', '100'].includes(filters.limit))
		return 'Choose 10, 25, 50, or 100 events per page.';
	if (
		filters.after &&
		(filters.after.length > 2048 || /[\u0000-\u001f\u007f]/.test(filters.after))
	)
		return 'The event cursor is invalid. Start again from the first page.';
	return null;
}

export function contractEventWorkspaceHref(filters: ExplorerFilters): string {
	const query = new URLSearchParams();
	for (const [name, value] of Object.entries(filters))
		if (value) query.set(name, value);
	return '/explorer/contract-events?' + query;
}
