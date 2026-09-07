'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
	buildEntityHref,
	entityText,
	recordValue,
	requestExplorerJson,
	normalizeWarehouseTimestamp,
	type EntityRecord,
	type ExplorerFilters
} from '../../api/explorer-analytics';
import { LocalDateTime } from '../local-date-time';
import { ExplorerEventProvenance } from './explorer-event-provenance';
import styles from './explorer-entity.module.css';
export function ExplorerContractActivity({
	contractId,
	filters
}: {
	readonly contractId: string;
	readonly filters: ExplorerFilters;
}): React.JSX.Element {
	const [tab, setTab] = useState<'events' | 'state'>('events'),
		[rows, setRows] = useState<readonly EntityRecord[]>([]);
	const [busy, setBusy] = useState(false),
		[error, setError] = useState<string | null>(null),
		[offset, setOffset] = useState(0),
		[nextOffset, setNextOffset] = useState<number | null>(null);
	const controller = useRef<AbortController | null>(null);
	const min = filters.min_ledger,
		max = filters.max_ledger;
	useEffect(() => {
		let disposed = false;
		const abort = new AbortController();
		controller.current = abort;
		setBusy(true);
		setError(null);
		setRows([]);
		setNextOffset(null);
		const timeout = setTimeout(() => abort.abort(), 25000);
		const query = new URLSearchParams({
			min_ledger: min ?? '',
			max_ledger: max ?? '',
			limit: '10',
			offset: String(offset)
		});
		void requestExplorerJson(
			'/v1/analytics/contracts/' +
				encodeURIComponent(contractId) +
				'/' +
				tab +
				'?' +
				query,
			abort.signal
		)
			.then((value) => {
				if (disposed) return;
				const data = recordValue(value);
				setRows(Array.isArray(data.rows) ? data.rows.map(recordValue) : []);
				setNextOffset(
					typeof data.nextOffset === 'number' ? data.nextOffset : null
				);
			})
			.catch((failure) => {
				if (!disposed)
					setError(
						abort.signal.aborted
							? 'Contract query timed out. Narrow the ledger range and try again.'
							: failure instanceof Error
								? failure.message
								: 'Contract data unavailable.'
					);
			})
			.finally(() => {
				clearTimeout(timeout);
				if (!disposed) setBusy(false);
			});
		return () => {
			disposed = true;
			clearTimeout(timeout);
			abort.abort();
		};
	}, [contractId, tab, offset, min, max]);
	return (
		<section
			className={styles.panel}
			aria-label="Contract activity"
			aria-busy={busy}
		>
			<div className={styles.actions}>
				<button
					aria-pressed={tab === 'events'}
					onClick={() => {
						setTab('events');
						setOffset(0);
					}}
				>
					Events
				</button>
				<button
					aria-pressed={tab === 'state'}
					onClick={() => {
						setTab('state');
						setOffset(0);
					}}
				>
					State changes
				</button>
			</div>
			<p className={styles.muted}>
				{tab === 'events'
					? 'Decoded event topics and payloads, linked to their transactions.'
					: 'Recorded key/value changes. This is historical evidence, not a complete current-state snapshot.'}
			</p>
			{busy && <p role="status">Loading contract {tab}…</p>}
			{error && (
				<p role="alert" className={styles.error}>
					{error}
				</p>
			)}
			{!busy && !error && rows.length === 0 && (
				<p>No contract {tab} in the selected published window.</p>
			)}
			{rows.map((row, index) => (
				<article
					className={styles.panel}
					key={entityText(row, '_row_number') + ':' + index}
				>
					<div className={styles.status}>
						<span>
							Ledger{' '}
							{entityText(row, 'ledger_sequence') ||
								entityText(row, '_ledger_sequence')}
						</span>
						{entityText(row, 'closed_at') && (
							<LocalDateTime
								dateTime={normalizeWarehouseTimestamp(
									entityText(row, 'closed_at')
								)}
							/>
						)}
					</div>
					{tab === 'events' && <ExplorerEventProvenance row={row} />}
					{entityText(row, 'transaction_hash') && (
						<Link
							href={buildEntityHref(
								'transactions',
								entityText(row, 'transaction_hash'),
								{
									ledger_sequence:
										entityText(row, 'ledger_sequence') ||
										entityText(row, '_ledger_sequence')
								}
							)}
						>
							Open transaction
						</Link>
					)}
					<dl className={styles.details}>
						{(tab === 'events'
							? [
									['Topics', row.topics_decoded ?? row.topics],
									['Payload', row.data_decoded ?? row.data]
								]
							: [
									['Key', row.key_decoded ?? row.key],
									['Value', row.val_decoded ?? row.val ?? row.value]
								]
						).flatMap(([label, value]) => [
							<dt key={String(label) + 'label'}>{String(label)}</dt>,
							<dd key={String(label)}>
								<pre className={styles.json}>
									{typeof value === 'string'
										? value
										: JSON.stringify(value ?? null, null, 2)}
								</pre>
							</dd>
						])}
					</dl>
					<details>
						<summary>Original event / state record</summary>
						<pre className={styles.json}>{JSON.stringify(row, null, 2)}</pre>
					</details>
				</article>
			))}
			<div className={styles.actions}>
				<button
					disabled={busy || offset === 0}
					onClick={() => setOffset(Math.max(0, offset - 10))}
				>
					Previous {tab}
				</button>
				<button
					disabled={busy || nextOffset === null}
					onClick={() => setOffset(nextOffset ?? offset)}
				>
					Next {tab}
				</button>
			</div>
		</section>
	);
}
