'use client';

import { ExplorerLink as Link } from './explorer-investigation';
import { entityText, recordValue, type EntityRecord, type ExplorerFilters } from '../../api/explorer-analytics';
import { LocalDateTime } from '../local-date-time';
import { formatDecimal } from './explorer-format-values';
import { ExplorerAssetPair, usePairMetadata } from './explorer-asset-pair';
import styles from './explorer-pool-table.module.css';
import { poolPairReportHref, poolRowDetailHref } from './pool-history-links';

export type PoolSort =
	| 'pool'
	| 'asset_a'
	| 'asset_b'
	| 'reserve_a'
	| 'reserve_b'
	| 'shares'
	| 'trustlines'
	| 'fee'
	| 'ledger'
	| 'time';
const columns: readonly [PoolSort, string][] = [
	['asset_a', 'Asset pair'],
	['reserve_a', 'Reserve A'],
	['reserve_b', 'Reserve B'],
	['shares', 'Pool shares'],
	['trustlines', 'Share trustlines'],
	['fee', 'Fee'],
	['ledger', 'Ledger'],
	['time', 'Updated'],
	['pool', 'Pool']
];

export function ExplorerPoolTable({
	rows,
	sort = 'trustlines',
	order = 'desc',
	onSort,
	context = {},
	pairReport
}: {
	readonly rows: readonly EntityRecord[];
	readonly sort?: PoolSort;
	readonly order?: 'asc' | 'desc';
	readonly onSort?: (key: PoolSort) => void;
	readonly context?: ExplorerFilters;
	readonly pairReport?: { readonly asset: string; readonly origin: string; readonly historicalWindow?: EntityRecord };
}): React.JSX.Element {
	const metadata = usePairMetadata(rows);
	return (
		<div className={styles.scroll}>
			<table className={styles.table} aria-label="Liquidity pools">
				<thead>
					<tr>
						{columns.map(([key, label]) => (
							<th
								key={key}
								aria-sort={
									sort === key
										? order === 'desc'
											? 'descending'
											: 'ascending'
										: 'none'
								}
							>
								{onSort ? (
									<button onClick={() => onSort(key)}>
										{label}
										<span aria-hidden="true">
											{sort === key ? (order === 'desc' ? ' ↓' : ' ↑') : ' ↕'}
										</span>
									</button>
								) : (
									label
								)}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, index) => {
						const id = entityText(row, 'id'),
							ledger = entityText(row, 'ledgerSequence');
						const detail = poolRowDetailHref(id, row.ledgerSequence, row.deleted, context);
						const market = pairReport && !row.deleted
							? poolPairReportHref(pairReport.asset, entityText(recordValue(row.assetA), 'id'),
								entityText(recordValue(row.assetB), 'id'), pairReport.origin, pairReport.historicalWindow)
							: null;
						return (
							<tr key={id + ':' + ledger + ':' + index}>
								<td>
									{row.deleted ? (
										'Removed pool'
									) : (
										<ExplorerAssetPair
											a={row.assetA}
											b={row.assetB}
											metadata={metadata}
										/>
									)}
									{market && <a className={styles.pairReport} href={market}>Historical pair report</a>}
								</td>
								<td className={styles.number}>
									{formatDecimal(entityText(row, 'reserveA'))}
								</td>
								<td className={styles.number}>
									{formatDecimal(entityText(row, 'reserveB'))}
								</td>
								<td className={styles.number}>
									{formatDecimal(entityText(row, 'shares'))}
								</td>
								<td className={styles.number}>
									{formatDecimal(entityText(row, 'trustlineCount'), 0)}
								</td>
								<td className={styles.number}>
									{row.feeBasisPoints == null
										? '—'
										: formatDecimal(Number(row.feeBasisPoints) / 100, 2) + '%'}
								</td>
								<td>
									<Link href={'/explorer/ledgers/' + ledger}>
										{formatDecimal(ledger, 0)}
									</Link>
								</td>
								<td className={styles.time}>
									<LocalDateTime dateTime={entityText(row, 'closedAt')} />
								</td>
								<td>
									{detail ? <Link
										className={styles.identifier}
										href={detail}
									>
										<code>{id}</code>
									</Link> : <code className={styles.identifier}>{id || '—'}</code>}
								</td>
							</tr>
						);
					})}
					{rows.length === 0 && (
						<tr>
							<td colSpan={columns.length} className={styles.empty}>
								No indexed pools match this selection.
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}
