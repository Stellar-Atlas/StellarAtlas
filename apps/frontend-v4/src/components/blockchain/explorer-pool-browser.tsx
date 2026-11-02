'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { poolBrowserHref, poolRouteKey, readPoolBrowserRoute, validPoolPosition, type PoolBrowserRoute } from './pool-browser-route';
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
import { poolContextFromRequest } from './pool-history-links';
import { ExplorerInvestigationScope } from './explorer-investigation';

type Page = {
	rows: readonly EntityRecord[];
	next: string | null;
	window: EntityRecord;
};
type DisplayedPage = Page & {
	requestPath: string;
	origin: string;
	sort: PoolSort;
	order: 'asc' | 'desc';
	historical: boolean;
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
interface Props {
	readonly initialFilters?: ExplorerFilters;
	readonly initialOffset?: number;
	readonly asset?: string;
	readonly embedded?: boolean;
}
export function ExplorerPoolBrowser({
	initialFilters = {}, initialOffset = 0, asset, embedded = false
}: Props): React.JSX.Element {
	return <PoolBrowser key={JSON.stringify([asset, embedded, initialFilters, initialOffset])}
		initialFilters={initialFilters} initialOffset={initialOffset} asset={asset} embedded={embedded} />;
}

function PoolBrowser({
	initialFilters = {},
	initialOffset = 0,
	asset,
	embedded = false
}: Props): React.JSX.Element {
	const pathname = usePathname() ?? '/explorer/liquidity-pools';
	const params = useSearchParams();
	const queryString = params?.toString() ?? '';
	const route = readPoolBrowserRoute(new URLSearchParams(queryString), initialFilters, initialOffset, embedded, asset);
	const { filters, sort, order, limit, position, historical } = route;
	const previousPages = useRef(new Map<string, PoolBrowserRoute>());
	const [page, setPage] = useState<DisplayedPage | null>(null);
	const [error, setError] = useState<string | null>(null),
		[busy, setBusy] = useState(false),
		[version, setVersion] = useState(0);
	const [search, setSearch] = useState(asset || initialFilters.asset || '');
	const [hasUpdates, setHasUpdates] = useState(false);
	const navigate = (selection: PoolBrowserRoute): void => {
		window.history.pushState(null, '', poolBrowserHref(pathname, queryString, selection, embedded, window.location.hash));
	};
	useEffect(() => setSearch(asset || filters.asset || ''), [asset, filters.asset]);
	useEffect(
		() =>
			subscribeWarehousePublication((event) => {
				if (event.datasets.includes('liquidity_pools')) setHasUpdates(true);
			}),
		[]
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
		const origin = poolBrowserHref(pathname, queryString, route, embedded, window.location.hash);
		setBusy(true);
		setError(null);
		setHasUpdates(false);
		void requestExplorerJson(path, abort.signal)
			.then((value) => {
				if (!abort.signal.aborted)
					setPage({ ...parsePage(value, historical), requestPath: path, origin, sort, order, historical });
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
	}, [path, historical, version, sort, order]);
	const matchesQuery = page?.requestPath === path;
	const refresh = () => {
		if (position) navigate({ ...route, position: '' });
		else setVersion((current) => current + 1);
	};
	const previous = previousPages.current.get(poolRouteKey(route));
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
								navigate({ ...route, filters: search.trim() ? { asset: search.trim() } : {}, historical: false, position: '' });
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
								navigate({ ...route, limit: event.target.value, position: '' });
							}}
						>
							{['10', '25', '50', '100'].map((value) => (
								<option key={value}>{value}</option>
							))}
						</select>
					</label>
					<button onClick={refresh}>
						Refresh
					</button>
					{hasUpdates && (
						<button onClick={refresh}>
							New data available
						</button>
					)}
					{historical && (
						<button
							onClick={() => {
								const selectedAsset = asset || filters.asset;
								navigate({ ...route, filters: selectedAsset ? { asset: selectedAsset } : {}, historical: false, position: '' });
							}}
						>
							Latest indexed pools
						</button>
					)}
				</div>
				<div className={ui.summary}>
					<span>
						{(page?.historical ?? historical)
							? 'Historical pool observations'
							: 'Latest indexed native pools'}
					</span>
					{page && <span>{page.rows.length} on this page</span>}
					{page && !matchesQuery && <span>Showing previous results.</span>}
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
					<ExplorerInvestigationScope origin={page.origin}>
					<ExplorerPoolTable
						rows={page.rows}
						sort={page.sort}
						order={page.order}
						context={page.historical ? poolContextFromRequest(page.requestPath, page.window) : undefined}
						onSort={(key) => {
							navigate({ ...route, sort: key, order: page.sort === key && page.order === 'desc' ? 'asc' : 'desc', position: '' });
						}}
					/>
					</ExplorerInvestigationScope>
				)}
				<div className={ui.pagination}>
					<span>{page && !matchesQuery ? 'Previous results' : historical && page ? page.rows.length ? `Rows ${Number(position || 0) + 1}–${Number(position || 0) + page.rows.length}` : 'No rows on this page' : position ? 'Continued page' : 'First page'}</span>
					<div>
						<button
							disabled={busy || !matchesQuery || !position}
							onClick={() => navigate(previous ?? { ...route, position: '' })}
						>
							{previous ? 'Previous' : 'First page'}
						</button>
						<button
							disabled={busy || !matchesQuery || !validPoolPosition(page?.next ?? null, historical) || page?.next === position}
							onClick={() => {
								const selection = { ...route, position: page?.next || '' };
								previousPages.current.set(poolRouteKey(selection), route);
								const oldest = previousPages.current.keys().next().value;
								if (previousPages.current.size > 50 && oldest) previousPages.current.delete(oldest);
								navigate(selection);
							}}
						>
							Next
						</button>
					</div>
				</div>
				{historical && page?.next && !validPoolPosition(page.next, true) && <p className={styles.muted}>Offset limit reached. Narrow the date or ledger range.</p>}
			</section>
		</div>
	);
}
