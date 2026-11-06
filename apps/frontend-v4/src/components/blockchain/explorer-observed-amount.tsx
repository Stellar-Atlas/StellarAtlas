import type { BalanceObservationRow } from '../../api/explorer-balance-observations';
import { formatAtomic, formatDecimal } from './explorer-format-values';
import { isClassicAccount } from '../../domain/classic-account';
import styles from './explorer-entity.module.css';

/** Human-unit Float64 observations are never rescaled or presented as exact raw amounts. */
export function formatObservedAmount(value: number): string {
	const formatted = formatDecimal(value, 20);
	if (Number(formatted.replaceAll(',', '')) === value) return formatted;
	const raw = String(value);
	const scientific = /^(-?)(\d)(?:\.(\d+))?e([+-]?\d+)$/.exec(raw);
	if (!scientific) return raw;
	const [, sign, leading, fraction = '', exponent] = scientific;
	const digits = leading! + fraction;
	const point = 1 + Number(exponent);
	if (point <= 0) return sign + '0.' + '0'.repeat(-point) + digits;
	return point >= digits.length ? sign + digits.padEnd(point, '0')
		: sign + digits.slice(0, point) + '.' + digits.slice(point);
}

export function observedTrustlineLimit(row: BalanceObservationRow): string | null {
	const raw = row.trustLineLimit;
	const classic = /^[A-Za-z0-9]{1,12}:G[A-Z2-7]{55}$/.test(row.id) && isClassicAccount(row.id.split(':')[1]!);
	return classic && row.assetType && row.assetType !== 'native' && raw !== null && /^\d{1,19}$/.test(raw) && BigInt(raw) <= 9223372036854775807n
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
