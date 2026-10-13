'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
	entityText,
	recordValue,
	requestExplorerJson,
	type EntityRecord
} from '../../api/explorer-analytics';
import { LocalDateTime } from '../local-date-time';
import { formatDecimal } from './explorer-format-values';
import styles from './explorer-entity.module.css';
import ui from './explorer-asset-workspace.module.css';

export function ExplorerAssetReports({
	asset,
	kind
}: {
	readonly asset: string;
	readonly kind: 'rankings' | 'balance-history';
}): React.JSX.Element {
	const [metric, setMetric] = useState('volume'),
		[counter, setCounter] = useState(''),
		[account, setAccount] = useState('');
	const [from, setFrom] = useState(''),
		[to, setTo] = useState('');
	const [selection, setSelection] = useState<Record<string, string>>({});
	const [cursor, setCursor] = useState(''),
		[history, setHistory] = useState<string[]>([]),
		[rows, setRows] = useState<readonly EntityRecord[]>([]),
		[next, setNext] = useState<string | null>(null),
		[busy, setBusy] = useState(false),
		[error, setError] = useState<string | null>(null),
		[coverage, setCoverage] = useState('');
	useEffect(() => {
		const abort = new AbortController();
		setBusy(true);
		setError(null);
		const query = new URLSearchParams({
			...selection,
			limit: '25',
			...(cursor ? { after: cursor } : {})
		});
		void requestExplorerJson(
			'/v1/assets/' + encodeURIComponent(asset) + '/' + kind + '?' + query,
			abort.signal
		)
			.then((raw) => {
				if (abort.signal.aborted) return;
				const page = recordValue(raw);
				if (!Array.isArray(page.data) || page.data.length > 25)
					throw new Error('Invalid report page');
				setRows(page.data.map(recordValue));
				setNext(typeof page.nextCursor === 'string' ? page.nextCursor : null);
				setCoverage(entityText(page, 'coverageStatus'));
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
	}, [asset, kind, selection, cursor]);
	const ranks = kind === 'rankings';
	return (
		<section className={styles.panel} aria-busy={busy}>
			<h3>{ranks ? 'Trading rankings' : 'Balance history'}</h3>
			<form
				className={ui.holderControls}
				onSubmit={(event) => {
					event.preventDefault();
					setCursor('');
					setHistory([]);
					setSelection({
						...(ranks ? { metric } : {}),
						...(counter && ranks ? { counter_asset: counter } : {}),
						...(account ? { account } : {}),
						...(from ? { start_time: new Date(from).toISOString() } : {}),
						...(to ? { end_time: new Date(to).toISOString() } : {})
					});
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
				<details>
					<summary>Date range</summary>
					<label>
						From
						<input
							type="datetime-local"
							value={from}
							onChange={(event) => setFrom(event.target.value)}
						/>
					</label>
					<label>
						To
						<input
							type="datetime-local"
							value={to}
							onChange={(event) => setTo(event.target.value)}
						/>
					</label>
				</details>
				<button disabled={busy}>Apply</button>
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
			<p className={styles.muted}>
				{coverage === 'complete'
					? 'Selected history indexed'
					: 'Indexed history · gaps remain'}
				{ranks ? ' · Classic DEX and native AMM' : ''}
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
						{rows.map((row, index) => {
							const id = entityText(row, 'account_id'),
								ledger = entityText(row, ranks ? 'last_ledger' : 'ledger'),
								sponsor = entityText(row, 'sponsor');
							return (
								<tr key={id + ':' + ledger + ':' + index}>
									<td>
										<Link
											className={styles.hash}
											href={'/explorer/accounts/' + id}
										>
											{id}
										</Link>
									</td>
									{ranks ? (
										<>
											<td className={ui.numeric}>
												{formatDecimal(entityText(row, 'asset_volume'))}
											</td>
											<td className={ui.numeric}>
												{row.counter_volume == null
													? '—'
													: formatDecimal(entityText(row, 'counter_volume'))}
											</td>
											<td>
												{formatDecimal(entityText(row, 'trade_count'), 0)}
											</td>
											<td>
												{formatDecimal(entityText(row, 'transaction_count'), 0)}
											</td>
											<td>
												<Link href={'/explorer/ledgers/' + ledger}>
													{formatDecimal(ledger, 0)}
												</Link>
											</td>
										</>
									) : (
										<>
											<td className={ui.numeric}>
												{formatDecimal(entityText(row, 'balance'))}
											</td>
											<td>
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
											<td>{row.deleted ? 'Removed' : 'Active'}</td>
											<td>
												<Link href={'/explorer/ledgers/' + ledger}>
													{formatDecimal(ledger, 0)}
												</Link>
											</td>
											<td>
												<LocalDateTime
													dateTime={
														entityText(row, 'ledger_closed_at').replace(
															' ',
															'T'
														) + 'Z'
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
			<div className={styles.actions}>
				<button
					disabled={busy || !history.length}
					onClick={() => {
						setCursor(history.at(-1) || '');
						setHistory((current) => current.slice(0, -1));
					}}
				>
					Previous
				</button>
				<button
					disabled={busy || !next}
					onClick={() => {
						setHistory((current) => [...current, cursor]);
						setCursor(next || '');
					}}
				>
					Next
				</button>
				<span>{rows.length} on this page</span>
			</div>
		</section>
	);
}
