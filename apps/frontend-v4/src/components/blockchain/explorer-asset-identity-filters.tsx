import type { ExplorerFilters } from '../../api/explorer-analytics';
import { ExplorerLink as Link } from './explorer-investigation';
import styles from './explorer-entity.module.css';

export function AssetIdentityFilters({ query, busy, onRemove }: {
	readonly query: ExplorerFilters;
	readonly busy: boolean;
	readonly onRemove: (key: 'issuer' | 'symbol') => void;
}): React.JSX.Element | null {
	if (!query.issuer && !query.symbol) return null;
	return <div className={styles.provenance} aria-label="Active asset identity filters">
		{(['issuer', 'symbol'] as const).map(key => query[key] && <div key={key} className={styles.identityFilter}>
			<span>{key === 'issuer' ? 'Issuer' : 'Asset code'}: {key === 'issuer'
				? <Link href={'/explorer/issuers/' + encodeURIComponent(query[key]!)}>{query[key]}</Link> : query[key]}</span>
			<button type="button" disabled={busy} onClick={() => onRemove(key)} aria-label={'Remove ' + key + ' filter'}>Remove</button>
		</div>)}
	</div>;
}
