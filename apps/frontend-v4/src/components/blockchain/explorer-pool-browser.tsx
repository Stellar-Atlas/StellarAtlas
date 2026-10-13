'use client';

import { useEffect, useMemo, useState } from 'react';
import {
	entityText,
	recordValue,
	requestExplorerJson,
	type EntityRecord,
	type ExplorerFilters
} from '../../api/explorer-analytics';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import { ExplorerPoolTable, type PoolSort } from './explorer-pool-table';
import styles from './explorer-entity.module.css';
import ui from './explorer-pool-table.module.css';
import { subscribeWarehousePublication } from '../../api/warehouse-publication-stream';

type Page = {
	rows: readonly EntityRecord[];
	next: string | null;
	window: EntityRecord;
};
function parsePage(raw: unknown, historical: boolean): Page {
	const value = recordValue(raw);
	if (!Array.isArray(value.rows) || value.rows.length > 100)
		throw new Error('Invalid liquidity pool page');
	return {
		rows: value.rows.map(recordValue),
		next: historical
			? value.nextOffset == null
				? null
				: String(value.nextOffset)
			: value.nextCursor == null
				? null
				: String(value.nextCursor),
		window: recordValue(value.window)
	};
}

/** Cursor pages remain bounded; sorting and filtering happen in ClickHouse, not the browser. */
export function ExplorerPoolBrowser({
	initialFilters = {},
	initialOffset = 0,
	asset,
	embedded = false
}: {
	readonly initialFilters?: ExplorerFilters;
	readonly initialOffset?: number;
	readonly asset?: string;
	readonly embedded?: boolean;
}): React.JSX.Element {
	const [filters, setFilters] = useState(initialFilters);
	const [sort, setSort] = useState<PoolSort>('trustlines'),
		[order, setOrder] = useState<'asc' | 'desc'>('desc');
	const [limit, setLimit] = useState('25'),
		[position, setPosition] = useState(String(initialOffset || ''));
	const [history, setHistory] = useState<string[]>([]),
		[page, setPage] = useState<Page | null>(null);
	const [error, setError] = useState<string | null>(null),
		[busy, setBusy] = useState(false),
		[version, setVersion] = useState(0);
	const [search, setSearch] = useState(asset || initialFilters.asset || '');
	const [hasUpdates, setHasUpdates] = useState(false);
	useEffect(
		() =>
			subscribeWarehousePublication((event) => {
				if (event.datasets.includes('liquidity_pools')) setHasUpdates(true);
			}),
		[]
	);
	const historical = !!(
		filters.min_ledger ||
		filters.max_ledger ||
		filters.start_time ||
		filters.end_time ||
		(initialOffset && version === 0)
	);
	const path = useMemo(() => {
		const query = new URLSearchParams({
			...filters,
			limit,
			order_by: sort,
			order
		});
		if (asset) query.set('asset', asset);
		if (!query.has('deleted')) query.set('deleted', 'false');
		if (historical) query.set('offset', position || '0');
		else if (position) query.set('after', position);
		return '/v1/liquidity-pools?' + query;
	}, [filters, limit, sort, order, asset, historical, position]);
	useEffect(() => {
		const abort = new AbortController();
		setBusy(true);
		setError(null);
		setHasUpdates(false);
		void requestExplorerJson(path, abort.signal)
			.then((value) => {
				if (!abort.signal.aborted) setPage(parsePage(value, historical));
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
	}, [path, historical, version]);
	const reset = () => {
		setPosition('');
		setHistory([]);
	};
	return (
		<div className={styles.workspace}>
			{!embedded && <ExplorerEntityNavigation active="liquidity-pools" />}
			<section className={styles.panel} aria-busy={busy}>
				{!embedded && <h2>Liquidity pools</h2>}
				<div className={ui.controls}>
					{!asset && (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								reset();
								setFilters(search.trim() ? { asset: search.trim() } : {});
								setVersion((current) => current + 1);
							}}
						>
							<label>
								Asset
								<input
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									placeholder="CODE:ISSUER or native"
								/>
							</label>
							<button>Filter</button>
						</form>
					)}
					<label>
						Rows
						<select
							value={limit}
							onChange={(event) => {
								setLimit(event.target.value);
								reset();
							}}
						>
							{['10', '25', '50', '100'].map((value) => (
								<option key={value}>{value}</option>
							))}
						</select>
					</label>
					<button
						onClick={() => {
							reset();
							setVersion((current) => current + 1);
						}}
					>
						Refresh
					</button>
					{hasUpdates && (
						<button
							onClick={() => {
								reset();
								setVersion((current) => current + 1);
							}}
						>
							New data available
						</button>
					)}
					{historical && (
						<button
							onClick={() => {
								reset();
								setFilters(asset ? { asset } : {});
								setVersion((current) => current + 1);
							}}
						>
							Latest indexed pools
						</button>
					)}
				</div>
				<div className={ui.summary}>
					<span>
						{historical
							? 'Historical pool observations'
							: 'Latest indexed native pools'}
					</span>
					{page && <span>{page.rows.length} on this page</span>}
					{busy && <span role="status">Loading…</span>}
				</div>
				{error && (
					<p className={styles.error} role="alert">
						{error}
						<button onClick={() => setVersion((current) => current + 1)}>
							Retry
						</button>
					</p>
				)}
				{page && (
					<ExplorerPoolTable
						rows={page.rows}
						sort={sort}
						order={order}
						onSort={(key) => {
							reset();
							setSort(key);
							setOrder(sort === key && order === 'desc' ? 'asc' : 'desc');
						}}
					/>
				)}
				<div className={ui.pagination}>
					<span>Page {history.length + 1}</span>
					<div>
						<button
							disabled={busy || history.length === 0}
							onClick={() => {
								setPosition(history.at(-1) || '');
								setHistory((current) => current.slice(0, -1));
							}}
						>
							Previous
						</button>
						<button
							disabled={busy || !page?.next}
							onClick={() => {
								setHistory((current) => [...current, position]);
								setPosition(page?.next || '');
							}}
						>
							Next
						</button>
					</div>
				</div>
			</section>
		</div>
	);
}
