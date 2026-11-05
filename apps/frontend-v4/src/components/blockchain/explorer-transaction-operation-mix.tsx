import type { EntityRecord } from '../../api/explorer-analytics';
import styles from './explorer-transaction-operation-mix.module.css';

export function ExplorerTransactionOperationMix({
	rows
}: { readonly rows: readonly EntityRecord[] }): React.JSX.Element | null {
	if (!rows.length) return null;
	const counts = new Map<string | null, number>();
	for (const row of rows) {
		const type = (typeof row.type === 'string' && row.type.trim()) || null;
		counts.set(type, (counts.get(type) ?? 0) + 1);
	}
	return (
		<div className={styles.summary}>
			<h4>Operation types on this page</h4>
			<dl aria-label="Operation types on this page">
				{[...counts].sort((a, b) => b[1] - a[1]).map(([type, count]) => (
					<div key={type === null ? 'unreported' : 'type:' + type}>
						<dt>{type?.replaceAll('_', ' ') ?? 'Type not reported'}</dt>
						<dd>{count}</dd>
					</div>
				))}
			</dl>
		</div>
	);
}
