import type { BalanceObservationKind, BalanceObservationPage } from '../../api/explorer-balance-observations';
import { LocalDateTime } from '../local-date-time';
import { formatDecimal } from './explorer-format-values';
import styles from './explorer-entity.module.css';

export function BalanceObservationProvenance({ kind, page }: {
	readonly kind: BalanceObservationKind;
	readonly page?: BalanceObservationPage;
}): React.JSX.Element {
	return <div className={styles.provenance}>
		<p className={styles.muted}>Latest ingested observations · not live balances</p>
		{page && <p className={styles.muted}>Catalog updated <LocalDateTime dateTime={page.catalogGeneratedAt} /></p>}
		<details className={styles.rangeFilters}>
			<summary>Coverage &amp; precision</summary>
			<div className={styles.provenance}>
				<p className={styles.muted}>These are not current-chain or historical as-of balances. This view is independent of the selected activity window.</p>
				<p className={styles.muted}>Amounts retain source Float64 precision; they are not exact stroop values.</p>
				{kind === 'holders' && <p className={styles.muted}>Positive observed balances, ordered by account—not a complete current-chain holder list or balance ranking.</p>}
				{page && <p className={styles.muted}>
					{formatDecimal(page.totalLedgerCount, 0)} completed ledgers · contiguous through {page.contiguousLastLedger === null ? 'unavailable' : formatDecimal(page.contiguousLastLedger, 0)} · {formatDecimal(page.gapCount, 0)} {page.gapCount === 1 ? 'gap' : 'gaps'}.
					{' '}Maximum observed catalog ledger {page.maximumLedger === null ? 'unavailable' : formatDecimal(page.maximumLedger, 0)}.
				</p>}
				<p className={styles.muted}>Pages are not a frozen snapshot; incoming ingestion can change observations between requests.</p>
			</div>
		</details>
	</div>;
}
