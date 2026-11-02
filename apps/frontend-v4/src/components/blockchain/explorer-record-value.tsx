import { resolveExplorerSearch } from '../../api/explorer-search-route';
import { buildEntityHref, type ExplorerFilters } from '../../api/explorer-analytics';
import { ExplorerLink } from './explorer-investigation';
import styles from './explorer-entity.module.css';

/** Only unambiguous addresses or explicitly named object fields become links. */
export function recordReferenceHref(field: string, value: unknown, filters: ExplorerFilters = {}): string | null {
	if (typeof value !== 'string' && typeof value !== 'number') return null;
	if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
	const text = String(value);
	if (/^[GC][A-Z2-7]{55}$/.test(text))
		return resolveExplorerSearch(text, text.startsWith('G') ? 'account' : 'contract');
	const key = field.replaceAll('_', '').toLowerCase();
	if (['ledger', 'ledgersequence', 'lastmodifiedledger'].includes(key))
		return resolveExplorerSearch(text, 'ledger');
	if (['transactionhash', 'txhash'].includes(key))
		return resolveExplorerSearch(text, 'transaction');
	if (key === 'operationid' && resolveExplorerSearch(text, 'operation'))
		return buildEntityHref('operations', text, filters);
	if (['asset', 'assetid', 'sellingasset', 'buyingasset'].includes(key))
		return resolveExplorerSearch(text, 'asset');
	return null;
}

export function ExplorerRecordValue({ field, value, filters }: {
	readonly field: string;
	readonly value: unknown;
	readonly filters?: ExplorerFilters;
}): React.JSX.Element {
	const href = recordReferenceHref(field, value, filters);
	const text = String(value);
	return href ? <ExplorerLink href={href} className={styles.hash}>{text}</ExplorerLink> : <>{text}</>;
}
