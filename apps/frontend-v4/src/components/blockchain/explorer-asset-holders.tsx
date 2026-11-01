'use client';

import { ExplorerLink as Link } from './explorer-investigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
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
import { holderRouteHref, readHolderRoute, type HolderSort, type HolderRoute } from './asset-holder-route';

type Loaded = {
	page: BalanceObservationPage;
	selection: BalanceObservationOptions;
	cursor: string | null;
	history: readonly (string | null)[];
};

export function ExplorerAssetHolders({
	identifier,
	autoLoad = true
}: {
	identifier: string;
	autoLoad?: boolean;
}): React.JSX.Element {
	const pathname = usePathname();
	const params = useSearchParams();
	const route = readHolderRoute(params);
	const { sort: selectedSort, includeZero: selectedZero, after } = route;
	const [sort, setSort] = useState<HolderSort>(selectedSort);
	const [includeZero, setIncludeZero] = useState(selectedZero);
	const selection = useMemo<BalanceObservationOptions>(() => {
		const [field, direction] = selectedSort.split('-');
		return { sort: field as 'balance' | 'account', order: direction as 'asc' | 'desc', includeZero: selectedZero };
	}, [selectedSort, selectedZero]);
	const histories = useMemo(() => new Map<string, readonly (string | null)[]>(), [selection]);
	useEffect(() => { setSort(selectedSort); setIncludeZero(selectedZero); }, [selectedSort, selectedZero]);
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
					selection,
					history
				};
			});
		},
		[identifier, selection, request.run]
	);
	useEffect(() => {
		if (enabled) load(after, histories.get(after ?? '') ?? []);
		return () => controller.current?.abort();
	}, [enabled, load, after, histories]);
	const navigate = (next: HolderRoute) => {
		const href = holderRouteHref(pathname, window.location.search, next, window.location.hash);
		if (href !== window.location.pathname + window.location.search + window.location.hash)
			window.history.pushState(null, '', href);
		else if (enabled) load(next.after, histories.get(next.after ?? '') ?? []);
		setEnabled(true);
	};
	const current = request.result;
	const matchesSelection = !current || (
		current.cursor === after &&
		current.selection.sort === selection.sort &&
		current.selection.order === selection.order &&
		Boolean(current.selection.includeZero) === Boolean(selection.includeZero)
	);
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
					navigate({ sort, includeZero, after: null });
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
						onChange={(event) => setSort(event.currentTarget.value as HolderSort)}
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
			{current && !matchesSelection && (
				<p className={styles.muted}>Showing previous holder results.</p>
			)}
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
							{current.selection.includeZero
								? 'No balances or trustlines in the selected indexed history.'
								: 'No positive balances in the selected indexed history.'}
						</p>
					)}
					<div className={styles.actions}>
						<button
							disabled={request.loading || !matchesSelection || !current.history.length}
							onClick={() =>
								navigate({ ...route, after: current.history.at(-1) ?? null })
							}
						>
							Previous
						</button>
						<button
							disabled={request.loading || !matchesSelection || !current.page.nextCursor}
							onClick={() => {
								if (!current.page.nextCursor) return;
								histories.set(current.page.nextCursor, [...current.history, current.cursor]);
								if (histories.size > 64) histories.delete(histories.keys().next().value!);
								navigate({ ...route, after: current.page.nextCursor });
							}}
						>
							Next
						</button>
						{after && <button disabled={request.loading} onClick={() => navigate({ ...route, after: null })}>First page</button>}
						<span className={styles.muted}>
							{current.page.rows.length} holders shown
						</span>
					</div>
				</>
			)}
		</section>
	);
}
