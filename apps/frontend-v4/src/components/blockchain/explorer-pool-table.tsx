'use client';

import { ExplorerLink as Link } from './explorer-investigation';
import { entityText, type EntityRecord } from '../../api/explorer-analytics';
import { LocalDateTime } from '../local-date-time';
import { formatDecimal } from './explorer-format-values';
import { ExplorerAssetPair, usePairMetadata } from './explorer-asset-pair';
import styles from './explorer-pool-table.module.css';

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
	onSort
}: {
	readonly rows: readonly EntityRecord[];
	readonly sort?: PoolSort;
	readonly order?: 'asc' | 'desc';
	readonly onSort?: (key: PoolSort) => void;
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
									<Link
										className={styles.identifier}
										href={'/explorer/liquidity-pools/' + encodeURIComponent(id)}
									>
										<code>{id}</code>
									</Link>
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
