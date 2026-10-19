'use client';

import { ExplorerLink as Link } from './explorer-investigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	fetchBalanceObservations,
	type BalanceObservationOptions,
	type BalanceObservationPage
} from '../../api/explorer-balance-observations';
import { useExplorerRequest } from './use-explorer-request';
import { ExplorerRequestNotice } from './explorer-browse-ui';
import styles from './explorer-entity.module.css';
import ui from './explorer-asset-workspace.module.css';
import { formatDecimal, formatAtomic } from './explorer-format-values';

type Sort = 'balance-desc' | 'balance-asc' | 'account-asc' | 'account-desc';
type Loaded = {
	page: BalanceObservationPage;
	cursor: string | null;
	history: readonly (string | null)[];
};
const INITIAL: BalanceObservationOptions = Object.freeze({
	sort: 'balance',
	order: 'desc'
});

export function ExplorerAssetHolders({
	identifier,
	autoLoad = true
}: {
	identifier: string;
	autoLoad?: boolean;
}): React.JSX.Element {
	const [sort, setSort] = useState<Sort>('balance-desc');
	const [includeZero, setIncludeZero] = useState(false);
	const [selection, setSelection] = useState(INITIAL);
	const [enabled, setEnabled] = useState(autoLoad);
	const request = useExplorerRequest<Loaded | null>(
		null,
		'Holder data is temporarily unavailable.'
	);
	const controller = useRef<AbortController | null>(null);
	const load = useCallback(
		(cursor: string | null, history: readonly (string | null)[]) => {
			void request.run(async () => {
				controller.current?.abort();
				const abort = new AbortController();
				controller.current = abort;
				return {
					page: await fetchBalanceObservations(
						'holders',
						identifier,
						cursor,
						abort.signal,
						selection
					),
					cursor,
					history
				};
			});
		},
		[identifier, selection, request.run]
	);
	useEffect(() => {
		if (enabled) load(null, []);
		return () => controller.current?.abort();
	}, [enabled, load]);
	const current = request.result;
	return (
		<section
			className={ui.holderSection}
			aria-label="Asset holders"
			aria-busy={request.loading}
		>
			<div className={ui.sectionHeading}>
				<h3>Holders</h3>
				<span
					className={ui.observationLabel}
					title="Balances are calculated from indexed account and trustline changes. Missing history may omit holders or changes. Source amounts retain floating-point precision."
				>
					Indexed balances ⓘ
				</span>
			</div>
			<form
				className={ui.holderControls}
				onSubmit={(event) => {
					event.preventDefault();
					const [field, direction] = sort.split('-');
					setSelection({
						includeZero,
						sort: field as 'balance' | 'account',
						order: direction as 'asc' | 'desc'
					});
					setEnabled(true);
				}}
			>
				<label>
					Include
					<select
						value={includeZero ? 'all' : 'positive'}
						onChange={(event) => setIncludeZero(event.target.value === 'all')}
					>
						<option value="positive">Positive balances</option>
						<option value="all">All balances / trustlines</option>
					</select>
				</label>
				<label>
					Order
					<select
						value={sort}
						onChange={(event) => setSort(event.currentTarget.value as Sort)}
					>
						<option value="balance-desc">Largest balance</option>
						<option value="balance-asc">Smallest balance</option>
						<option value="account-asc">Address A–Z</option>
						<option value="account-desc">Address Z–A</option>
					</select>
				</label>
				<button type="submit" disabled={request.loading}>
					{current ? 'Apply' : 'Show holders'}
				</button>
			</form>
			<ExplorerRequestNotice
				loading={request.loading}
				error={request.error}
				onRetry={request.retry}
			/>
			{current && (
				<>
					<div className={ui.holderSummary}>
						{current.page.indexedHolderCount !== undefined && (
							<strong>
								{Number(current.page.indexedHolderCount).toLocaleString()}{' '}
								indexed holders
							</strong>
						)}
						{current.page.indexedBalanceTotal !== undefined && (
							<span>
								{current.page.indexedBalanceTotal.toLocaleString(undefined, {
									maximumFractionDigits: 7
								})}{' '}
								total indexed balance
							</span>
						)}
						{current.page.indexStatus === 'building' && (
							<span>Holder index backfill in progress</span>
						)}
						<span>
							{current.page.selectedLedger ? (
								<>
									Changes through{' '}
									<Link
										href={'/explorer/ledgers/' + current.page.selectedLedger}
									>
										{Number(current.page.selectedLedger).toLocaleString()}
									</Link>
								</>
							) : (
								'Latest indexed changes'
							)}
						</span>
						{current.page.coverageStatus !== 'complete' && (
							<span title="The indexed history has gaps. These results are not a complete chain-state snapshot.">
								Partial history
							</span>
						)}
					</div>
					<div className={styles.tableWrap}>
						<table className={`${styles.table} ${ui.holderTable}`}>
							<thead>
								<tr>
									<th>Account</th>
									<th className={ui.numeric}>Balance</th>
									<th className={ui.numeric}>Buying liabilities</th>
									<th className={ui.numeric}>Selling liabilities</th>
									<th>Observed ledger</th>
									<th>Sponsor</th>
									<th className={ui.numeric}>Trustline limit</th>
								</tr>
							</thead>
							<tbody>
								{current.page.rows.map((row) => (
									<tr key={row.id}>
										<td>
											<Link
												className={styles.hash}
												href={
													'/explorer/accounts/' + encodeURIComponent(row.id)
												}
											>
												{row.id}
											</Link>
										</td>
										<td className={ui.numeric}>
											{row.balance.toLocaleString(undefined, {
												maximumFractionDigits: 7
											})}
										</td>
										<td className={ui.numeric}>
											{formatDecimal(row.buyingLiabilities)}
										</td>
										<td className={ui.numeric}>
											{formatDecimal(row.sellingLiabilities)}
										</td>
										<td>
											<Link href={'/explorer/ledgers/' + row.observedLedger}>
												{row.observedLedger.toLocaleString()}
											</Link>
										</td>
										<td>
											{row.sponsor ? (
												<Link
													className={styles.hash}
													href={'/explorer/accounts/' + row.sponsor}
												>
													{row.sponsor}
												</Link>
											) : (
												'—'
											)}
										</td>
										<td className={ui.numeric}>
											{row.trustLineLimit
												? formatAtomic(row.trustLineLimit, 7)
												: '—'}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{current.page.rows.length === 0 && (
						<p className={styles.muted}>
							No positive balances in the selected indexed history.
						</p>
					)}
					<div className={styles.actions}>
						<button
							disabled={request.loading || !current.history.length}
							onClick={() =>
								load(
									current.history.at(-1) ?? null,
									current.history.slice(0, -1)
								)
							}
						>
							Previous
						</button>
						<button
							disabled={request.loading || !current.page.nextCursor}
							onClick={() =>
								load(current.page.nextCursor, [
									...current.history,
									current.cursor
								])
							}
						>
							Next
						</button>
						<span className={styles.muted}>
							{current.page.rows.length} holders shown
						</span>
					</div>
				</>
			)}
		</section>
	);
}
