import { ExplorerLink as Link } from './explorer-investigation';
import { buildEntityHref, entityText, type EntityRecord } from '../../api/explorer-analytics';
import { LocalDateTime } from '../local-date-time';
import { formatDecimal } from './explorer-format-values';
import styles from './explorer-entity.module.css';
import ui from './explorer-pair-report.module.css';

const assetLabel = (asset: string): string => asset === 'native' ? 'XLM (native)' : asset;
const symbol = (asset: string): string => asset === 'native' ? 'XLM' : asset.split(':')[0]!;

/** Historical native-pool changes, never a current liquidity or valuation model. No data loading. */
export function ExplorerHistoricalPoolTable({ rows, assetA, assetB }: {
	readonly rows: readonly EntityRecord[];
	readonly assetA: string;
	readonly assetB: string;
}): React.JSX.Element {
	return <div className={styles.provenance}>
		<div className={styles.provenance} aria-label="Pool reserve assets">
			{([['A', assetA], ['B', assetB]] as const).map(([side, asset]) => <p key={side} className={styles.muted}>
				Asset {side}: <Link className={styles.hash} href={buildEntityHref('assets', asset)}>{assetLabel(asset)}</Link>
			</p>)}
		</div>
		<div className={styles.tableWrap}>
			<table className={styles.table} aria-label="Historical native pool changes">
				<thead><tr>{['Pool', 'Change', 'Reserve A (' + symbol(assetA) + ')', 'Reserve B (' + symbol(assetB) + ')', 'Share trustlines', 'Ledger / time'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
				<tbody>{rows.map((row, index) => {
					const id = entityText(row, 'id'), ledger = entityText(row, 'ledgerSequence'), removed = row.deleted === true;
					const amount = (field: string): string => removed || row[field] == null ? '—' : formatDecimal(entityText(row, field), field === 'trustlineCount' ? 0 : 7);
					return <tr key={id + ':' + ledger + ':' + index}>
						<td data-label="Pool"><Link className={styles.hash} href={buildEntityHref('liquidity-pools', id, { min_ledger: ledger, max_ledger: ledger })}>{id}</Link></td>
						<td data-label="Change">{removed ? 'Removed' : row.deleted === false ? 'Observed' : 'Not recorded'}</td>
						<td data-label={'Reserve A (' + symbol(assetA) + ')'} className={ui.numeric}>{amount('reserveA')}</td>
						<td data-label={'Reserve B (' + symbol(assetB) + ')'} className={ui.numeric}>{amount('reserveB')}</td>
						<td data-label="Share trustlines" className={ui.numeric}>{amount('trustlineCount')}</td>
						<td data-label="Ledger / time"><Link href={buildEntityHref('ledgers', ledger)}>{formatDecimal(ledger, 0)}</Link><div className={styles.muted}><LocalDateTime dateTime={entityText(row, 'closedAt')} /></div></td>
					</tr>;
				})}</tbody>
			</table>
			{!rows.length && <p className={styles.empty}>No matching pool observations in the published range.</p>}
		</div>
	</div>;
}
