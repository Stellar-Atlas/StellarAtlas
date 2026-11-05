import { entityText, recordValue, type AnalyticsEntityPage, type EntityRecord } from '../../api/explorer-analytics';
import { assetPairReportHref } from './asset-market-route';
import styles from './explorer-asset-workspace.module.css';

const previewLimit = 6;

/** Shortcuts derived only from the existing bounded trade preview. */
export function ExplorerAssetMarketPairs({ asset, origin, rows, window }: {
	readonly asset: string;
	readonly origin: string;
	readonly rows: readonly EntityRecord[];
	readonly window: AnalyticsEntityPage['window'];
}): React.JSX.Element | null {
	const observed = new Map<string, { label: string; href: string; sellingSide: number; buyingSide: number }>();
	const labels = new Set<string>();
	const collisions = new Set<string>();
	for (const row of rows) {
		const sold = entityText(recordValue(row.sellingAsset), 'id');
		const bought = entityText(recordValue(row.buyingAsset), 'id');
		const onSellingSide = sold === asset;
		const counter = onSellingSide ? bought : bought === asset ? sold : '';
		if (!counter || counter === asset) continue;
		const existing = observed.get(counter);
		if (existing) {
			if (onSellingSide) existing.sellingSide++;
			else existing.buyingSide++;
			continue;
		}
		const href = assetPairReportHref(asset, sold, bought, window, origin);
		if (!href) continue;
		const label = counter === 'native' ? 'XLM' : counter.split(':')[0]!;
		if (labels.has(label)) collisions.add(label);
		labels.add(label);
		observed.set(counter, { label, href, sellingSide: onSellingSide ? 1 : 0, buyingSide: onSellingSide ? 0 : 1 });
	}
	if (observed.size === 0) return null;
	return (
		<nav aria-label="Observed trading pairs" className={styles.observedPairs}>
			<h4>Observed pairs</h4>
			<ul>
				{[...observed].slice(0, previewLimit).map(([id, { label, href, sellingSide, buyingSide }]) => (
					<li key={id}>
						<a href={href} title={id}>
							<strong>{label}</strong>
							{collisions.has(label) && <code>{id.split(':')[1] ?? id}</code>}
							<span className={styles.pairDirection} aria-hidden="true">
								<span style={{ inlineSize: `${sellingSide / (sellingSide + buyingSide) * 100}%` }} />
							</span>
							<span className={styles.pairCounts}>
								Recorded selling side: {sellingSide} · Recorded buying side: {buyingSide}
							</span>
						</a>
					</li>
				))}
			</ul>
			<span>
				Loaded preview only. Counts show which recorded side contains the selected asset.
				Every trade has both sides. These counts measure neither volume nor buying or selling pressure.
				{observed.size > previewLimit ? ' More pairs in the trades below.' : ''}
			</span>
		</nav>
	);
}
