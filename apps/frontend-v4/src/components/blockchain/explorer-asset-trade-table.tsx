'use client';

import { entityText, recordValue, type AnalyticsEntityPage, type EntityRecord } from '../../api/explorer-analytics';
import { LocalDateTime } from '../local-date-time';
import { ExplorerAssetPair, usePairMetadata } from './explorer-asset-pair';
import { ExplorerLink as Link } from './explorer-investigation';
import { formatMarketAmount, marketAssetLabel } from './explorer-market-values';
import styles from './explorer-entity.module.css';
import ui from './explorer-asset-workspace.module.css';

/** Bounded historical trade rows; caller supplies the accepted response window. */
export function ExplorerAssetTradeTable({ rows, window }: {
	readonly rows: readonly EntityRecord[];
	readonly window: AnalyticsEntityPage['window'];
}): React.JSX.Element {
	const metadata = usePairMetadata(rows, ['sellingAsset', 'buyingAsset']);
	return (
		<div className={styles.tableWrap}>
			<table className={styles.table} aria-label="Trade observations">
				<thead><tr><th>Pair</th><th>Sold → bought</th><th>Operation</th><th>Ledger</th><th>Time</th><th>Report</th></tr></thead>
				<tbody>{rows.map((row, index) => (
					<tr key={entityText(row, 'id') + ':' + index}>
						<td data-label="Pair"><ExplorerAssetPair a={row.sellingAsset} b={row.buyingAsset} metadata={metadata} /></td>
						<td data-label="Sold → bought" className={ui.numeric}><div>
							{formatMarketAmount(entityText(row, 'sellingAmount'))} {marketAssetLabel(row.sellingAsset)}{' → '}
							{formatMarketAmount(entityText(row, 'buyingAmount'))} {marketAssetLabel(row.buyingAsset)}
						</div></td>
						<td data-label="Operation"><div><Link className={styles.hash} href={'/explorer/operations/' + entityText(row, 'operationId')}>
							{entityText(row, 'operationId')}
						</Link></div></td>
						<td data-label="Ledger"><div><Link href={'/explorer/ledgers/' + entityText(row, 'ledgerSequence')}>
							{Number(row.ledgerSequence).toLocaleString('en-US')}
						</Link></div></td>
						<td data-label="Time"><div>{typeof row.closedAt === 'string' && <LocalDateTime dateTime={row.closedAt} />}</div></td>
						<td data-label="Report"><div><Link href={'/explorer/markets?' + new URLSearchParams({
							asset_a: entityText(recordValue(row.sellingAsset), 'id'),
							asset_b: entityText(recordValue(row.buyingAsset), 'id'),
							min_ledger: String(window.minLedger), max_ledger: String(window.maxLedger)
						})}>Pair report</Link></div></td>
					</tr>
				))}</tbody>
			</table>
		</div>
	);
}
