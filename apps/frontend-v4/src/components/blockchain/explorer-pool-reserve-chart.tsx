import { buildEntityHref, entityText, recordValue, type EntityRecord } from '../../api/explorer-analytics';
import { ExplorerLink as Link } from './explorer-investigation';
import { formatMarketAmount } from './explorer-market-values';
import { poolDetailHref } from './pool-history-links';
import styles from './explorer-pool-reserve-chart.module.css';

const maxPools = 8;
const classicAsset = /^[A-Za-z0-9]{1,12}:G[A-Z2-7]{55}$/;
const label = (id: string): string => id === 'native' ? 'XLM' : id.split(':', 1)[0]!;
const assetId = (value: unknown): string => entityText(recordValue(value), 'id');

function chartRows(asset: string, rows: readonly EntityRecord[]) {
	const seen = new Set<string>();
	return rows.flatMap(row => {
		if (row.deleted !== false) return [];
		const a = assetId(row.assetA), b = assetId(row.assetB);
		if (a === b || (a !== asset && b !== asset)) return [];
		const id = entityText(row, 'id'), counter = a === asset ? b : a;
		const amount = a === asset ? row.reserveA : row.reserveB;
		const ledger = entityText(row, 'ledgerSequence');
		if (!/^[a-f0-9]{64}$/i.test(id) || seen.has(id) || (counter !== 'native' && !classicAsset.test(counter)) ||
			!/^[1-9]\d{0,9}$/.test(ledger) || Number(ledger) > 4294967295 ||
			typeof amount !== 'string' || !/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(amount)) return [];
		const magnitude = Number(amount);
		if (!Number.isFinite(magnitude)) return [];
		seen.add(id);
		return [{ id, counter, amount, magnitude, ledger }];
	}).sort((a, b) => b.magnitude - a.magnitude);
}

/** A comparison of the displayed page, never a liquidity total or a historical series. */
export function ExplorerPoolReserveChart({ asset, rows }: {
	readonly asset: string;
	readonly rows: readonly EntityRecord[];
}): React.JSX.Element | null {
	const selected = /^native$/i.test(asset) ? 'native' : asset;
	if (selected !== 'native' && !classicAsset.test(selected)) return null;
	const matching = chartRows(selected, rows);
	const shown = matching.slice(0, maxPools);
	if (!shown.length) return null;
	const unit = label(selected);
	const max = shown[0]!.magnitude;
	return (
		<section className={styles.chart} aria-label="Pool reserve comparison">
			<h3>Pool reserves in {unit}</h3>
			<p>Showing {shown.length} of {matching.length} comparable pools on this page. Latest indexed reserves, not live balances.</p>
			{selected !== 'native' && <Link className={styles.identity} href={buildEntityHref('assets', selected)}>{selected}</Link>}
			<ol>
				{shown.map(row => (
					<li key={row.id}>
						<div className={styles.row}>
							<Link href={poolDetailHref(row.id)} title={row.counter === 'native' ? 'XLM (native)' : row.counter}
								aria-label={label(row.counter) + ' pool ' + row.id}>
								{label(row.counter)} pool
							</Link>
							<strong>{formatMarketAmount(row.amount)} {unit}</strong>
						</div>
						<div className={styles.track} aria-hidden="true">
							<div className={styles.bar} style={{ width: (max ? row.magnitude / max * 100 : 0) + '%' }} />
						</div>
						<Link className={styles.observed} href={buildEntityHref('ledgers', row.ledger)}>Ledger {formatMarketAmount(row.ledger)}</Link>
					</li>
				))}
			</ol>
			<p>Source Float64 precision. See the pool table for both reserves and all rows on this page.</p>
		</section>
	);
}
