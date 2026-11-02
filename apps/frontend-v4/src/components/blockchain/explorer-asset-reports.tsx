'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ExplorerLink as Link, ExplorerInvestigationScope } from './explorer-investigation';
import {
	entityText,
	requestExplorerJson,
	normalizeWarehouseTimestamp
} from '../../api/explorer-analytics';
import { parseAssetReportPage, type AssetReportPage } from '../../api/explorer-asset-reports';
import { assetReportHref, readAssetReportRoute, reportSelectionKey, validateReportQuery, reportDateInput, utcReportDate, type AssetReportKind, type AssetReportQuery } from './asset-report-route';
import { LocalDateTime } from '../local-date-time';
import { formatDecimal } from './explorer-format-values';
import styles from './explorer-entity.module.css';
import ui from './explorer-asset-workspace.module.css';

export function ExplorerAssetReports({
	asset,
	kind
}: {
	readonly asset: string;
	readonly kind: AssetReportKind;
}): React.JSX.Element {
	const pathname = usePathname();
	const search = useSearchParams().toString();
	const route = readAssetReportRoute(new URLSearchParams(search), asset, kind);
	const selectionKey = reportSelectionKey(asset, kind, route.query);
	const previous = useRef(new Map<string, string>());
	const navigate = (query: AssetReportQuery, after = '') => {
		const href = assetReportHref(pathname, search, asset, kind, query, after, window.location.hash);
		if (href !== window.location.pathname + window.location.search + window.location.hash) window.history.pushState(null, '', href);
	};
	return <ReportPage key={JSON.stringify([selectionKey, route.after, route.error])} asset={asset} kind={kind} query={route.query} after={route.after} routeError={route.error}
		origin={pathname + (search ? '?' + search : '')}
		previous={route.after ? previous.current.get(selectionKey + route.after) ?? '' : ''}
		navigate={(query, after = '', remember = false) => {
			if (after && remember) {
				previous.current.set(selectionKey + after, route.after);
				if (previous.current.size > 50) previous.current.delete(previous.current.keys().next().value!);
			}
			navigate(query, after);
		}} />;
}

function ReportPage({asset, kind, query, after, routeError, previous, navigate, origin}: {
	readonly asset: string; readonly kind: AssetReportKind; readonly query: AssetReportQuery;
	readonly after: string; readonly routeError: string | null; readonly previous: string;
	readonly navigate: (query: AssetReportQuery, after?: string, remember?: boolean) => void; readonly origin: string;
}): React.JSX.Element {
	const [metric, setMetric] = useState(query.metric ?? 'volume'), [counter, setCounter] = useState(query.counter_asset ?? ''), [account, setAccount] = useState(query.account ?? '');
	const [from, setFrom] = useState(reportDateInput(query.start_time ?? '')), [to, setTo] = useState(reportDateInput(query.end_time ?? ''));
	const [order, setOrder] = useState(query.order ?? 'desc');
	const [page, setPage] = useState<AssetReportPage | null>(null), [busy, setBusy] = useState(!routeError), [error, setError] = useState(routeError), [reload, setReload] = useState(0);
	// This component is keyed by asset, report kind, validated selection and cursor.
	// A failed/new selection never inherits the previous page, coverage or cursor.
	const requestQuery = new URLSearchParams({...query, limit: '25', ...(after ? {after} : {})}).toString();
	useEffect(() => {
		if (routeError) return;
		const abort = new AbortController();
		setBusy(true);
		setError(null);
		setPage(null);
		void requestExplorerJson(
			'/v1/assets/' + encodeURIComponent(asset) + '/' + kind + '?' + requestQuery,
			abort.signal
		)
			.then((raw) => {
				if (abort.signal.aborted) return;
				setPage(parseAssetReportPage(raw, asset));
			})
			.catch((cause: unknown) => {
				if (!abort.signal.aborted)
					setError(
						cause instanceof Error ? cause.message : 'Report unavailable'
					);
			})
			.finally(() => {
				if (!abort.signal.aborted) setBusy(false);
			});
		return () => abort.abort();
	}, [asset, kind, requestQuery, routeError, reload]);
	const ranks = kind === 'rankings';
	return (
		<ExplorerInvestigationScope origin={origin}><section className={styles.panel} aria-busy={busy} aria-label={ranks ? 'Trading rankings' : 'Balance history'}>
			<h3>{ranks ? 'Trading rankings' : 'Balance history'}</h3>
			<form
				className={ui.holderControls}
				onSubmit={(event) => {
					event.preventDefault();
					try {
						const selected = validateReportQuery(kind, {...query, order, ...(ranks ? {metric, counter_asset: counter.trim()} : {}), account: account.trim(), start_time: utcReportDate(from, query.start_time), end_time: utcReportDate(to, query.end_time)});
						navigate(selected);
						if (!after && !routeError && reportSelectionKey(asset, kind, query) === reportSelectionKey(asset, kind, selected)) setReload((value) => value + 1);
					} catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid report selection.'); }
				}}
			>
				{ranks && (
					<>
						<label>
							Rank by
							<select
								value={metric}
								onChange={(event) => setMetric(event.target.value)}
							>
								<option value="volume">Traded amount</option>
								<option value="bought">Bought amount</option>
								<option value="sold">Sold amount</option>
								<option value="transactions">Trading transactions</option>
							</select>
						</label>
						<label>
							Counter asset
							<input
								value={counter}
								onChange={(event) => setCounter(event.target.value)}
								placeholder="native or CODE:ISSUER"
							/>
						</label>
					</>
				)}
				<label>
					Account
					<input
						value={account}
						onChange={(event) => setAccount(event.target.value)}
						placeholder="Optional G or C address"
					/>
				</label>
				<label>Order<select value={order} onChange={(event) => setOrder(event.target.value)}><option value="desc">{ranks ? 'Highest first' : 'Newest first'}</option><option value="asc">{ranks ? 'Lowest first' : 'Oldest first'}</option></select></label>
				<details>
					<summary>Date range (UTC)</summary>
					<label>
						From (UTC)
						<input
							type="datetime-local"
							step="0.001"
							value={from}
							onChange={(event) => setFrom(event.target.value)}
						/>
					</label>
					<label>
						To (UTC)
						<input
							type="datetime-local"
							step="0.001"
							value={to}
							onChange={(event) => setTo(event.target.value)}
						/>
					</label>
				</details>
				<button disabled={busy}>Apply</button>
				<button type="button" disabled={busy} onClick={() => navigate({order: 'desc', ...(ranks ? {metric: 'volume'} : {})})}>Reset report</button>
			</form>
			{busy && (
				<p role="status" className={styles.muted}>
					Loading indexed report…
				</p>
			)}
			{error && (
				<p role="alert" className={styles.error}>
					{error}
				</p>
			)}
			{error && !routeError && <button type="button" disabled={busy} onClick={() => setReload((value) => value + 1)}>Retry report</button>}
			{page && <><p className={styles.muted}>
				{page.complete
					? 'Selected history indexed'
					: 'Indexed history · gaps remain'}
				{ranks ? ' · Classic DEX and native AMM' : ''}
				{' · Source Float64 amounts'}
				{!ranks && ' · Historical observations, not current balances'}
				{(query.min_ledger || query.max_ledger) && ` · Ledgers ${query.min_ledger ?? 'earliest'}–${query.max_ledger ?? 'latest indexed'}`}
			</p>
			<div className={styles.tableWrap}>
				<table className={styles.table}>
					<thead>
						<tr>
							<th>Account</th>
							{ranks ? (
								<>
									<th>Asset volume</th>
									<th>Counter volume</th>
									<th>Trades</th>
									<th>Transactions</th>
									<th>Last ledger</th>
								</>
							) : (
								<>
									<th>Balance</th>
									<th>Sponsor</th>
									<th>State</th>
									<th>Ledger</th>
									<th>Time</th>
								</>
							)}
						</tr>
					</thead>
					<tbody>
						{page.rows.map((row, index) => {
							const id = entityText(row, 'account_id'),
								ledger = entityText(row, ranks ? 'last_ledger' : 'ledger'),
								sponsor = entityText(row, 'sponsor');
							return (
								<tr key={id + ':' + ledger + ':' + index}>
									<td data-label="Account">
										<Link
											className={styles.hash}
											href={'/explorer/accounts/' + id}
										>
											{id}
										</Link>
									</td>
									{ranks ? (
										<>
											<td data-label="Asset volume" className={ui.numeric}>
												{formatDecimal(entityText(row, 'asset_volume'))}
											</td>
											<td data-label="Counter volume" className={ui.numeric}>
												{row.counter_volume == null
													? '—'
													: formatDecimal(entityText(row, 'counter_volume'))}
											</td>
											<td data-label="Trades">
												{formatDecimal(entityText(row, 'trade_count'), 0)}
											</td>
											<td data-label="Transactions">
												{formatDecimal(entityText(row, 'transaction_count'), 0)}
											</td>
											<td data-label="Last ledger">
												<Link href={'/explorer/ledgers/' + ledger}>
													{formatDecimal(ledger, 0)}
												</Link>
											</td>
										</>
									) : (
										<>
											<td data-label="Balance" className={ui.numeric}>
												{formatDecimal(entityText(row, 'balance'))}
											</td>
											<td data-label="Sponsor">
												{sponsor ? (
													<Link
														className={styles.hash}
														href={'/explorer/accounts/' + sponsor}
													>
														{sponsor}
													</Link>
												) : (
													'—'
												)}
											</td>
											<td data-label="State">{row.deleted === true || row.deleted === 1 ? 'Removed' : row.deleted === false || row.deleted === 0 ? 'Active' : 'Unknown'}</td>
											<td data-label="Ledger">
												<Link href={'/explorer/ledgers/' + ledger}>
													{formatDecimal(ledger, 0)}
												</Link>
											</td>
											<td data-label="Time">
												<LocalDateTime
													dateTime={
														normalizeWarehouseTimestamp(entityText(row, 'ledger_closed_at'))
													}
												/>
											</td>
										</>
									)}
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			{!page.rows.length && <p>No indexed {ranks ? 'trading activity' : 'balance observations'} match this selection.</p>}
			<div className={styles.actions}>
				<button
					disabled={busy || !!error || !after}
					onClick={() => navigate(query, previous)}
				>
					{previous ? 'Previous' : 'First page'}
				</button>
				<button
					disabled={busy || !!error || !page.next}
					onClick={() => navigate(query, page.next ?? '', true)}
				>
					Next
				</button>
				<span>{page.rows.length} on this page</span>
			</div>
			</>}
		</section></ExplorerInvestigationScope>
	);
}
