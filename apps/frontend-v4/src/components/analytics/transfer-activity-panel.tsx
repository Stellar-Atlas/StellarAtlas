'use client';

import { useId, useState } from 'react';
import { localTimeInput } from '../../api/explorer-search-route';
import { formatTransferAmount, type TransferFilters } from '../../api/transfer-activity';
import { ExplorerInvestigationScope, ExplorerLink } from '../blockchain/explorer-investigation';
import { LocalDateTime } from '../local-date-time';
import { transferFields, transferTransactionReference } from './transfer-investigation-route';
import { useTransferInvestigation } from './use-transfer-investigation';
import styles from './transfer-activity-panel.module.css';
const sample: TransferFilters = {
	asset: 'native',
	event_topic: 'transfer',
	min_ledger: '26000000',
	max_ledger: '26000099'
};

export function TransferActivityPanel(): React.JSX.Element {
	const activity = useTransferInvestigation();
	return (
		<ExplorerInvestigationScope origin={activity.href}>
			<TransferActivityView key={activity.href} activity={activity} />
		</ExplorerInvestigationScope>
	);
}

function TransferActivityView({ activity }: {
	readonly activity: ReturnType<typeof useTransferInvestigation>;
}): React.JSX.Element {
	const id = useId();
	const [filters, setFilters] = useState<TransferFilters>(activity.filters);
	const { page: result, error, busy, requestPath } = activity;

	return (
		<section className={styles.panel} aria-labelledby={id} aria-busy={busy}>
			<div>
				<h2 id={id}>Transfer activity</h2>
				<p>
					Query parsed ClickHouse data by account, asset, sender, recipient,
					date and exact amount. This is the same data service used by typed
					GraphQL.
				</p>
			</div>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					activity.submit(filters);
				}}
			>
				<fieldset disabled={busy} className={styles.form}>
					<legend>Filters</legend>
					{transferFields.map(([key, label, type]) => (
						<label key={key}>
							{label}
							<input
								type={type}
								value={type === 'datetime-local'
									? localTimeInput(filters[key] ?? '')
									: filters[key] ?? ''}
								onChange={(event) => {
									const value = event.currentTarget.value;
									setFilters((current) => ({
										...current,
										[key]: value
									}));
								}}
							/>
						</label>
					))}
				</fieldset>
				<p>
					Results describe published historical transfers, not current state.
					Leaving ledger bounds empty queries the latest 100,000 published
					ledger positions. Explicit windows support up to 1,000,000 positions;
					dates narrow that window. Amount filters use raw integer units: native
					and classic issued assets use 10,000,000 units per token.
				</p>
				<div className={styles.actions}>
					<button type="submit" disabled={busy}>
						Find transfers
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => setFilters(sample)}
					>
						Load sample
					</button>
					{busy && (
						<button type="button" onClick={activity.cancel}>
							Cancel request
						</button>
					)}
				</div>
			</form>
			<p role="status" aria-live="polite">
				{error ?? (busy ? 'Requesting transfers…' : result
					? result.transfers.length + ' returned'
					: 'Edit filters and select Find transfers.')}
			</p>
			{activity.retry && <button type="button" onClick={activity.retry}>Retry transfers</button>}
			{(result || activity.previous) && (
				<div className={styles.actions}>
					<button type="button" disabled={busy || !activity.previous} onClick={activity.previous ?? undefined}>
						Previous transfers
					</button>
					<button type="button" disabled={busy || !activity.next} onClick={activity.next ?? undefined}>
						Next transfers
					</button>
				</div>
			)}
			{requestPath && <code className={styles.request}>GET {requestPath}</code>}
			{result && (
				<>
					<p>
						Returned window: ledgers{' '}
						{result.watermark.minimumLedger.toLocaleString()}–
						{result.watermark.maximumLedger.toLocaleString()}. Published data
						only; gaps and later backfills may exist. An empty page does not
						establish that an account never held this asset.
					</p>
					{result.transfers.length === 0 ? (
						<p>No matching published transfers in this window.</p>
					) : (
						<ul className={styles.rows}>
							{result.transfers.map((row) => {
								const transaction = transferTransactionReference(row.transactionHash, row.ledgerSequence);
								return (
								<li className={styles.row} key={row.id}>
									<strong>
										{formatTransferAmount(row.amountRaw, row.amountScale)}{' '}
										{row.asset.id} · {row.eventTopic}
									</strong>
									<dl>
										<dt>Ledger</dt>
										<dd>
											{row.ledgerSequence.toLocaleString()} ·{' '}
											<LocalDateTime dateTime={row.closedAt} />
										</dd>
										<dt>From</dt>
										<dd>{row.from ?? 'not supplied'}</dd>
										<dt>To</dt>
										<dd>{row.toMuxed ?? row.to ?? 'not supplied'}</dd>
										<dt>Transaction</dt>
										<dd>{transaction.href
											? <ExplorerLink href={transaction.href}>{transaction.label}</ExplorerLink>
											: transaction.label}</dd>
										<dt>Raw amount</dt>
										<dd>
											{row.amountRaw}
											{row.amountScale === null
												? ' (token decimal scale unknown)'
												: ''}
										</dd>
									</dl>
								</li>
								);
							})}
						</ul>
					)}
					<details>
						<summary>Actual JSON response</summary>
						<pre className={styles.response}>
							{JSON.stringify(result, null, 2)}
						</pre>
					</details>
				</>
			)}
		</section>
	);
}
