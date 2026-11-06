import { useId, useState } from 'react';
import { entityText, recordValue, type AnalyticsEntityPage, type EntityRecord } from '../../api/explorer-analytics';
import { assetPairReportHref } from './asset-market-route';
import styles from './explorer-asset-workspace.module.css';

const previewLimit = 6;
type Pair = { label: string; href: string; buys: number; sells: number };

/** Counts only the deduplicated rows already loaded for this trade preview. */
export function ExplorerAssetMarketPairs({ asset, origin, rows, window }: {
	readonly asset: string;
	readonly origin: string;
	readonly rows: readonly EntityRecord[];
	readonly window: AnalyticsEntityPage['window'];
}): React.JSX.Element | null {
	const heading = useId();
	const table = useId();
	const [expanded, setExpanded] = useState(false);
	const observed = new Map<string, Pair>();
	const labels = new Set<string>();
	const collisions = new Set<string>();
	for (const row of rows) {
		const sold = entityText(recordValue(row.sellingAsset), 'id');
		const bought = entityText(recordValue(row.buyingAsset), 'id');
		const counter = sold === asset ? bought : bought === asset ? sold : '';
		if (!counter || counter === asset) continue;
		let pair = observed.get(counter);
		if (!pair) {
			const href = assetPairReportHref(asset, sold, bought, window, origin);
			if (!href) continue;
			const label = counter === 'native' ? 'XLM' : counter.split(':')[0]!;
			if (labels.has(label)) collisions.add(label);
			labels.add(label);
			pair = { label, href, buys: 0, sells: 0 };
			observed.set(counter, pair);
		}
		if (sold === asset) pair.sells++;
		else pair.buys++;
	}
	if (observed.size === 0) return null;
	const pairs = [...observed].sort(([, a], [, b]) => (b.buys + b.sells) - (a.buys + a.sells));
	const maximum = Math.max(...pairs.map(([, { buys, sells }]) => Math.max(buys, sells)));
	const count = (value: number) => (
		<>
			<span>{value}</span>
			<span aria-hidden="true" className={styles.pairCountTrack}>
				<span style={{ width: (100 * value / maximum) + '%' }} />
			</span>
		</>
	);
	return (
		<section aria-labelledby={heading} className={styles.observedPairs}>
			<h4 id={heading}>Observed pair activity</h4>
			<table id={table} aria-labelledby={heading}>
				<caption>Trade counts from this preview only. Buy and sell refer to this asset.</caption>
				<thead><tr>
					<th scope="col">Counter asset</th>
					<th scope="col">Buys</th>
					<th scope="col">Sells</th>
				</tr></thead>
				<tbody>
					{(expanded ? pairs : pairs.slice(0, previewLimit)).map(([id, { label, href, buys, sells }]) => (
						<tr key={id}>
							<th scope="row">
								<a href={href} title={id}>
									{label}
									{collisions.has(label) && <code>{id.split(':')[1] ?? id}</code>}
								</a>
							</th>
							<td>{count(buys)}</td>
							<td>{count(sells)}</td>
						</tr>
					))}
				</tbody>
			</table>
			{pairs.length > previewLimit && (
				<button type="button" aria-expanded={expanded} aria-controls={table} onClick={() => setExpanded(!expanded)}>
					{expanded ? 'Show fewer pairs' : `Show all ${pairs.length} observed pairs`}
				</button>
			)}
		</section>
	);
}
