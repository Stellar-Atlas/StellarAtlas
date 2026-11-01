import type { ContractActivityTab } from '../../api/explorer-contract-activity';

/** Separate from the enclosing asset's `tab` parameter. */
export function readContractActivityTab(value: string | null): ContractActivityTab {
	return value === 'state' ? 'state' : 'events';
}

/** Tab selection must not discard event cursors, investigation filters or anchors. */
export function contractActivityTabHref(
	pathname: string,
	search: string,
	tab: ContractActivityTab,
	hash = ''
): string {
	const params = new URLSearchParams(search);
	if (tab === 'state') params.set('activity', 'state');
	else params.delete('activity');
	return pathname + (params.size ? '?' + params.toString() : '') + hash;
}
