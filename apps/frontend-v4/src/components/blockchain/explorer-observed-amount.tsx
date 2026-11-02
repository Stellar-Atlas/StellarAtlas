import type { BalanceObservationRow } from '../../api/explorer-balance-observations';
import { formatAtomic, formatDecimal } from './explorer-format-values';
import styles from './explorer-entity.module.css';

/** Human-unit Float64 observations are never rescaled or presented as exact raw amounts. */
export function formatObservedAmount(value: number): string {
	const formatted = formatDecimal(value, 20);
	return Number(formatted.replaceAll(',', '')) === value ? formatted : String(value);
}

export function observedTrustlineLimit(row: BalanceObservationRow): string | null {
	const raw = row.trustLineLimit;
	return row.assetType && row.assetType !== 'native' && raw !== null && /^\d{1,19}$/.test(raw) && BigInt(raw) <= 9223372036854775807n
		? formatAtomic(raw, 7) : null;
}

export function ObservedAmountSource({ row }: { readonly row: BalanceObservationRow }): React.JSX.Element {
	return <details className={styles.amountSource}>
		<summary>Source values</summary>
		<dl>
			<dt>Balance (Float64)</dt><dd>{String(row.balance)}</dd>
			<dt>Buying liabilities (Float64)</dt><dd>{String(row.buyingLiabilities)}</dd>
			<dt>Selling liabilities (Float64)</dt><dd>{String(row.sellingLiabilities)}</dd>
			{row.trustLineLimit !== null && <><dt>Trustline limit (raw)</dt><dd>{row.trustLineLimit}</dd></>}
		</dl>
	</details>;
}
