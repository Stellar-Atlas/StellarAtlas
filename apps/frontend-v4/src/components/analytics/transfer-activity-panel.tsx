'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
	buildTransferActivityPath,
	formatTransferAmount,
	parseTransferActivityPage,
	type TransferActivityPage,
	type TransferFilters
} from '../../api/transfer-activity';
import { LocalDateTime } from '../local-date-time';
import styles from './transfer-activity-panel.module.css';

const fields = [
	[
		'event_topic',
		'Event topic (transfer, mint, burn, clawback or fee)',
		'text'
	],
	['account', 'Account (sender or recipient)', 'text'],
	['asset', 'Asset (native or CODE:ISSUER)', 'text'],
	['from', 'Sender', 'text'],
	['to', 'Recipient', 'text'],
	['min_ledger', 'First ledger (included)', 'text'],
	['max_ledger', 'Last ledger (included)', 'text'],
	['start_time', 'From time (your timezone, included)', 'datetime-local'],
	['end_time', 'Until time (your timezone, excluded)', 'datetime-local'],
	['min_amount_raw', 'Minimum raw integer amount', 'text'],
	['max_amount_raw', 'Maximum raw integer amount', 'text'],
	['transaction_hash', 'Transaction hash', 'text'],
	['contract_id', 'Token contract ID', 'text']
] as const;
const sample: TransferFilters = {
	asset: 'native',
	event_topic: 'transfer',
	min_ledger: '26000000',
	max_ledger: '26000099'
};

export function TransferActivityPanel(): React.JSX.Element {
	const id = useId();
	const [filters, setFilters] = useState<TransferFilters>(sample);
	const [result, setResult] = useState<TransferActivityPage | null>(null);
	const [status, setStatus] = useState(
		'No request sent. Edit filters and select Find transfers.'
	);
	const [requestPath, setRequestPath] = useState('');
	const [busy, setBusy] = useState(false);
	const [cursor, setCursor] = useState<string | undefined>();
	const [history, setHistory] = useState<(string | undefined)[]>([]);
	const [submitted, setSubmitted] = useState<TransferFilters>(sample);
	const controller = useRef<AbortController | null>(null);
	useEffect(() => () => controller.current?.abort(), []);

	async function run(
		nextFilters: TransferFilters,
		nextCursor?: string,
		direction: 'reset' | 'next' | 'previous' = 'reset'
	): Promise<void> {
		if (controller.current) return;
		const abort = new AbortController();
		controller.current = abort;
		const timeout = setTimeout(() => abort.abort(), 20_000);
		setBusy(true);
		const started = performance.now();
		try {
			const path = buildTransferActivityPath(nextFilters, nextCursor);
			setRequestPath(path);
			setStatus('Requesting parsed transfer data…');
			const response = await fetch(path, {
				headers: { accept: 'application/json' },
				credentials: 'omit',
				signal: abort.signal
			});
			const body: unknown = await response.json();
			if (!response.ok) {
				const detail =
					typeof body === 'object' &&
					body !== null &&
					'error' in body &&
					typeof body.error === 'string'
						? body.error
						: typeof body === 'object' &&
							  body !== null &&
							  'message' in body &&
							  typeof body.message === 'string'
							? body.message
							: 'Request could not be completed.';
				throw new Error('HTTP ' + response.status + ': ' + detail);
			}
			const page = parseTransferActivityPage(body);
			setResult(page);
			setSubmitted({ ...nextFilters });
			setHistory((current) =>
				direction === 'next'
					? [...current, cursor]
					: direction === 'previous'
						? current.slice(0, -1)
						: []
			);
			setCursor(nextCursor);
			setStatus(
				'HTTP ' +
					response.status +
					' · ' +
					Math.round(performance.now() - started) +
					' ms · ' +
					page.transfers.length +
					' returned'
			);
		} catch (error) {
			setStatus(
				abort.signal.aborted
					? 'Request canceled or timed out. Previous results remain visible.'
					: error instanceof Error
						? error.message
						: 'Request failed.'
			);
		} finally {
			clearTimeout(timeout);
			controller.current = null;
			setBusy(false);
		}
	}

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
					void run(filters);
				}}
			>
				<fieldset disabled={busy} className={styles.form}>
					<legend>Filters</legend>
					{fields.map(([key, label, type]) => (
						<label key={key}>
							{label}
							<input
								type={type}
								value={filters[key] ?? ''}
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
					Sample range is historical, not current state. Leaving ledger bounds
					empty queries the latest 100,000 published ledger positions. Explicit
					windows support up to 1,000,000 positions; dates narrow that window.
					Amount filters use raw integer units: native and classic issued assets
					use 10,000,000 units per token.
				</p>
				<div className={styles.actions}>
					<button type="submit" disabled={busy}>
						Find transfers
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => {
							setFilters(sample);
							setStatus('Sample loaded. Select Find transfers.');
						}}
					>
						Load sample
					</button>
					{busy && (
						<button type="button" onClick={() => controller.current?.abort()}>
							Cancel request
						</button>
					)}
				</div>
			</form>
			<p role="status" aria-live="polite">
				{status}
			</p>
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
					<div className={styles.actions}>
						<button
							disabled={busy || history.length === 0}
							onClick={() => void run(submitted, history.at(-1), 'previous')}
						>
							Previous transfers
						</button>
						<button
							disabled={busy || !result.nextCursor}
							onClick={() =>
								void run(submitted, result.nextCursor ?? undefined, 'next')
							}
						>
							Next transfers
						</button>
					</div>
					{result.transfers.length === 0 ? (
						<p>No matching published transfers in this window.</p>
					) : (
						<ul className={styles.rows}>
							{result.transfers.map((row) => (
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
										<dd>{row.transactionHash}</dd>
										<dt>Raw amount</dt>
										<dd>
											{row.amountRaw}
											{row.amountScale === null
												? ' (token decimal scale unknown)'
												: ''}
										</dd>
									</dl>
								</li>
							))}
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
