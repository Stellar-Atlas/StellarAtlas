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
	const observed = new Map<string, { label: string; href: string }>();
	const labels = new Set<string>();
	const collisions = new Set<string>();
	for (const row of rows) {
		const sold = entityText(recordValue(row.sellingAsset), 'id');
		const bought = entityText(recordValue(row.buyingAsset), 'id');
		const counter = sold === asset ? bought : bought === asset ? sold : '';
		if (!counter || observed.has(counter)) continue;
		const href = assetPairReportHref(asset, sold, bought, window, origin);
		if (!href) continue;
		const label = counter === 'native' ? 'XLM' : counter.split(':')[0]!;
		if (labels.has(label)) collisions.add(label);
		labels.add(label);
		observed.set(counter, { label, href });
	}
	if (observed.size === 0) return null;
	return (
		<nav aria-label="Observed trading pairs" className={styles.observedPairs}>
			<h4>Observed pairs</h4>
			<ul>
				{[...observed].slice(0, previewLimit).map(([id, { label, href }]) => (
					<li key={id}>
						<a href={href} title={id}>
							<strong>{label}</strong>
							{collisions.has(label) && <code>{id.split(':')[1] ?? id}</code>}
						</a>
					</li>
				))}
			</ul>
			<span>From this trade preview{observed.size > previewLimit ? ' · More pairs in the trades below' : ''}</span>
		</nav>
	);
}
