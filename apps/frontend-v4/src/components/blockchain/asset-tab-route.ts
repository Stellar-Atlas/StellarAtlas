export const assetTabOptions = [
	{ value: 'overview', label: 'Overview' },
	{ value: 'holders', label: 'Holders' },
	{ value: 'transfers', label: 'Transfers' },
	{ value: 'markets', label: 'Markets' },
	{ value: 'contracts-events', label: 'Contracts & events' },
	{ value: 'rankings', label: 'Rankings' },
	{ value: 'balance-history', label: 'Balance history' },
	{ value: 'same-symbol', label: 'Same symbol' }
] as const;

export type AssetTab = (typeof assetTabOptions)[number]['label'];

export function readAssetTab(value: string | null): AssetTab {
	return (
		assetTabOptions.find((option) => option.value === value)?.label ?? 'Overview'
	);
}

/** Change only the tab; retain investigation filters, return context and anchor. */
export function assetTabHref(
	pathname: string,
	search: string,
	tab: AssetTab,
	hash = ''
): string {
	const params = new URLSearchParams(search);
	const value =
		assetTabOptions.find((option) => option.label === tab)?.value ?? 'overview';
	if (value === 'overview') params.delete('tab');
	else params.set('tab', value);
	return pathname + (params.size ? '?' + params.toString() : '') + hash;
}
