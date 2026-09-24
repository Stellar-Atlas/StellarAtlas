'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { buildEntityHref } from '../../api/explorer-analytics';
import {
	fetchBalanceObservations,
	type BalanceObservationKind,
	type BalanceObservationPage
} from '../../api/explorer-balance-observations';
import { useExplorerRequest } from './use-explorer-request';
import { ExplorerRequestNotice } from './explorer-browse-ui';
import { LocalDateTime } from '../local-date-time';
import styles from './explorer-entity.module.css';

interface LoadedPage {
	readonly page: BalanceObservationPage;
	readonly cursor: string | null;
	readonly history: readonly (string | null)[];
}
export function ExplorerBalanceObservations({
	kind,
	identifier
}: {
	readonly kind: BalanceObservationKind;
	readonly identifier: string;
}): React.JSX.Element {
	const request = useExplorerRequest<LoadedPage | null>(
		null,
		`Parsed ${kind} are temporarily unavailable. Try this request again.`
	);
	const controller = useRef<AbortController | null>(null);
	useEffect(() => () => controller.current?.abort(), []);
	const current = request.result;
	const load = (
		cursor: string | null,
		history: readonly (string | null)[]
	): void => {
		void request.run(async () => {
			controller.current?.abort();
			const abort = new AbortController();
			controller.current = abort;
			const timeout = setTimeout(() => abort.abort(), 25000);
			try {
				return {
					page: await fetchBalanceObservations(
						kind,
						identifier,
						cursor,
						abort.signal
					),
					cursor,
					history
				};
			} finally {
				clearTimeout(timeout);
				if (controller.current === abort) controller.current = null;
			}
		});
	};
	return (
		<section
			className={styles.panel}
			aria-label={
				kind === 'balances' ? 'Parsed account balances' : 'Parsed asset holders'
			}
			aria-busy={request.loading}
		>
			<h2>{kind === 'balances' ? 'Account balances' : 'Asset holders'}</h2>
			<p className={styles.muted}>
				Latest ingested observations, not current-chain or historical as-of
				balances. This view is independent of the selected activity window.
				Amounts retain source Float64 precision; they are not exact stroop
				values.
			</p>
			{kind === 'holders' && (
				<p className={styles.muted}>
					Positive observed balances, ordered by account—not a complete
					current-chain holder list or balance ranking.
				</p>
			)}
			<div className={styles.actions}>
				<button
					type="button"
					disabled={request.loading}
					onClick={() => load(null, [])}
				>
					{current ? 'Refresh first page' : `Load ${kind}`}
				</button>
			</div>
			<ExplorerRequestNotice
				loading={request.loading}
				error={request.error}
				onRetry={request.retry}
			/>
			{current && (
				<>
					<BalanceObservationResults kind={kind} page={current.page} />
					<div className={styles.actions}>
						<button
							type="button"
							disabled={request.loading || current.history.length === 0}
							onClick={() =>
								load(
									current.history.at(-1) ?? null,
									current.history.slice(0, -1)
								)
							}
						>
							Previous {kind}
						</button>
						<button
							type="button"
							disabled={request.loading || current.page.nextCursor === null}
							onClick={() =>
								load(current.page.nextCursor, [
									...current.history,
									current.cursor
								])
							}
						>
							Next {kind}
						</button>
						<span>{current.page.rows.length} returned</span>
					</div>
				</>
			)}
		</section>
	);
}

export function BalanceObservationResults({
	kind,
	page
}: {
	readonly kind: BalanceObservationKind;
	readonly page: BalanceObservationPage;
}): React.JSX.Element {
	const label = kind === 'balances' ? 'Asset' : 'Account';
	return (
		<>
			<div className={styles.status}>
				<span>
					Catalog snapshot <LocalDateTime dateTime={page.catalogGeneratedAt} />
				</span>
				<span>
					{page.totalLedgerCount} completed ledgers · contiguous through{' '}
					{page.contiguousLastLedger ?? 'unavailable'} · {page.gapCount} gaps
				</span>
				<span>
					Maximum observed catalog ledger {page.maximumLedger ?? 'unavailable'}
				</span>
			</div>
			<p className={styles.muted}>
				Pages are not a frozen snapshot; incoming ingestion can change
				observations between requests.
			</p>
			{page.rows.length === 0 ? (
				<p>
					No {kind} returned from the ingested observations. This does not
					establish absence on the current chain.
				</p>
			) : (
				<div className={styles.tableWrap}>
					<table className={styles.table}>
						<thead>
							<tr>
								{[
									label,
									'Observed balance',
									'Liabilities',
									'Ledger evidence'
								].map((column) => (
									<th key={column} scope="col">
										{column}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{page.rows.map((row) => (
								<tr key={row.id}>
									<td data-label={label}>
										<Link
											className={styles.hash}
											href={buildEntityHref(
												kind === 'balances' ? 'assets' : 'accounts',
												row.id
											)}
										>
											{row.id === 'native' ? 'XLM (native)' : row.id}
										</Link>
									</td>
									<td data-label="Observed balance">
										{String(row.balance)}
										{row.trustLineLimit !== null && (
											<div className={styles.muted}>
												Trustline limit (raw): {row.trustLineLimit}
											</div>
										)}
									</td>
									<td data-label="Liabilities">
										Buying: {String(row.buyingLiabilities)}
										<br />
										Selling: {String(row.sellingLiabilities)}
									</td>
									<td data-label="Ledger evidence">
										<Link
											href={buildEntityHref(
												'ledgers',
												String(row.observedLedger)
											)}
										>
											Observed {row.observedLedger}
										</Link>
										<div className={styles.muted}>
											Last modified {row.lastModifiedLedger}
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</>
	);
}
