'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { requestExplorerJson } from '../../api/explorer-analytics';
import {
	formatTransferAmount,
	parseTransferActivityPage,
	type TransferActivityPage
} from '../../api/transfer-activity';
import type { Asset } from './explorer-asset-types';
import { LocalDateTime } from '../local-date-time';
import styles from './explorer-entity.module.css';
import ui from './explorer-asset-workspace.module.css';

function Wallet({ address }: { address: string | null }): React.JSX.Element {
	if (!address) return <>—</>;
	return (
		<Link
			className={ui.plainHash}
			href={
				'/explorer/' +
				(address.startsWith('C') ? 'contracts' : 'accounts') +
				'/' +
				encodeURIComponent(address)
			}
		>
			{address}
		</Link>
	);
}

export function ExplorerAssetActivity({
	asset
}: {
	asset: Asset;
}): React.JSX.Element {
	const latest = asset.lastObservedLedger;
	const [before, setBefore] = useState<number | undefined>(latest);
	const [after, setAfter] = useState<string | null>(null);
	const [history, setHistory] = useState<readonly (string | null)[]>([]);
	const [page, setPage] = useState<TransferActivityPage | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		const abort = new AbortController();
		const params = new URLSearchParams({ limit: '25' });
		if (asset.kind === 'contract')
			params.set('contract_id', asset.contractId || asset.id);
		else params.set('asset', asset.id);
		if (before !== undefined) {
			params.set('min_ledger', String(Math.max(2, before - 2047)));
			params.set('max_ledger', String(before));
		}
		if (after) params.set('after', after);
		setBusy(true);
		setError(null);
		void requestExplorerJson('/v1/activity/transfers?' + params, abort.signal)
			.then((value) => {
				if (!abort.signal.aborted) setPage(parseTransferActivityPage(value));
			})
			.catch((cause) => {
				if (!abort.signal.aborted)
					setError(
						cause instanceof Error ? cause.message : 'Activity unavailable.'
					);
			})
			.finally(() => {
				if (!abort.signal.aborted) setBusy(false);
			});
		return () => abort.abort();
	}, [asset.id, asset.kind, asset.contractId, before, after]);
	const window = (value: number | undefined) => {
		setBefore(value);
		setAfter(null);
		setHistory([]);
		setPage(null);
	};
	return (
		<section className={ui.holderSection} aria-busy={busy}>
			<div className={ui.sectionHeading}>
				<h3>Transfers &amp; transactions</h3>
				<span className={ui.observationLabel}>Published activity</span>
			</div>
			<div className={styles.actions}>
				<button
					disabled={busy || before === undefined || before <= 2}
					onClick={() =>
						window(
							before === undefined ? undefined : Math.max(2, before - 2048)
						)
					}
				>
					Earlier activity
				</button>
				<button disabled={busy} onClick={() => window(latest)}>
					Latest indexed activity
				</button>
			</div>
			{busy && <p role="status">Loading transfers…</p>}
			{error && (
				<p className={styles.error} role="alert">
					{error}
				</p>
			)}
			{page && (
				<>
					<div className={styles.tableWrap}>
						<table className={styles.table}>
							<thead>
								<tr>
									<th>Time</th>
									<th>From</th>
									<th>To</th>
									<th className={ui.numeric}>Amount</th>
									<th>Transaction</th>
									<th>Ledger</th>
								</tr>
							</thead>
							<tbody>
								{page.transfers.map((row) => (
									<tr key={row.id}>
										<td>
											<LocalDateTime dateTime={row.closedAt} />
										</td>
										<td>
											<Wallet address={row.from} />
										</td>
										<td>
											<Wallet address={row.to} />
										</td>
										<td className={ui.numeric}>
											{formatTransferAmount(row.amountRaw, row.amountScale)}
										</td>
										<td>
											<Link
												className={ui.plainHash}
												href={'/explorer/transactions/' + row.transactionHash}
											>
												{row.transactionHash}
											</Link>
											{row.operationId && (
												<small>
													<Link
														href={'/explorer/operations/' + row.operationId}
													>
														Operation {row.operationId}
													</Link>
												</small>
											)}
										</td>
										<td>
											<Link href={'/explorer/ledgers/' + row.ledgerSequence}>
												{row.ledgerSequence.toLocaleString()}
											</Link>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{!page.transfers.length && (
						<p className={styles.muted}>
							No transfers in this indexed window. Earlier activity may exist.
						</p>
					)}
					<div className={styles.actions}>
						<button
							disabled={busy || !history.length}
							onClick={() => {
								setAfter(history.at(-1) ?? null);
								setHistory((current) => current.slice(0, -1));
							}}
						>
							Previous
						</button>
						<button
							disabled={busy || !page.nextCursor}
							onClick={() => {
								setHistory((current) => [...current, after]);
								setAfter(page.nextCursor);
							}}
						>
							Next
						</button>
						<span className={ui.observationLabel}>
							{page.watermark.coverage === 'complete'
								? 'Selected window indexed'
								: 'Partial indexed history'}
						</span>
					</div>
				</>
			)}
		</section>
	);
}
