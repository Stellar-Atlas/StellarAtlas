'use client';
import { ExplorerLink as Link } from './explorer-investigation';
import { useEffect, useState } from 'react';
import {
	entityText,
	recordValue,
	requestExplorerJson,
	type EntityRecord,
	type ExplorerFilters
} from '../../api/explorer-analytics';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import { ExplorerPoolTable } from './explorer-pool-table';
import styles from './explorer-entity.module.css';

export function ExplorerPoolDetail({
	id,
	filters
}: {
	readonly id: string;
	readonly filters: ExplorerFilters;
}): React.JSX.Element {
	const [row, setRow] = useState<EntityRecord | null>(null),
		[error, setError] = useState<string | null>(null),
		[busy, setBusy] = useState(true),
		[version, setVersion] = useState(0);
	const query = new URLSearchParams(
		Object.entries(filters).filter(([key]) =>
			[
				'min_ledger',
				'max_ledger',
				'start_time',
				'end_time',
				'deleted'
			].includes(key)
		)
	).toString();
	useEffect(() => {
		const abort = new AbortController();
		setBusy(true);
		setError(null);
		void requestExplorerJson(
			'/v1/liquidity-pools/' +
				encodeURIComponent(id) +
				(query ? '?' + query : ''),
			abort.signal
		)
			.then((raw) => {
				if (abort.signal.aborted) return;
				const value = recordValue(raw);
				setRow(value.record ? recordValue(value.record) : null);
			})
			.catch((cause: unknown) => {
				if (!abort.signal.aborted)
					setError(
						cause instanceof Error ? cause.message : 'Pool data unavailable'
					);
			})
			.finally(() => {
				if (!abort.signal.aborted) setBusy(false);
			});
		return () => abort.abort();
	}, [id, query, version]);
	return (
		<div className={styles.workspace}>
			<ExplorerEntityNavigation active="liquidity-pools" />
			<section className={styles.panel} aria-busy={busy}>
				<div className={styles.actions}>
					<h2>Native liquidity pool</h2>
					<Link href="/explorer/liquidity-pools">All pools →</Link>
				</div>
				<code className={styles.hash}>{id}</code>
				{busy && <p role="status">Loading…</p>}
				{error && (
					<p role="alert">
						{error}
						<button onClick={() => setVersion((current) => current + 1)}>
							Retry
						</button>
					</p>
				)}
				{row && (
					<>
						<p className={styles.muted}>
							{query ? 'Historical observation' : 'Latest indexed state'} ·{' '}
							{entityText(row, 'type').replaceAll('_', ' ')}
						</p>
						<ExplorerPoolTable rows={[row]} />
					</>
				)}
				{!row && !busy && !error && (
					<p>No published pool state in this selection.</p>
				)}
			</section>
		</div>
	);
}
