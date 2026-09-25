'use client';
import Link from 'next/link';
import { localTimeInput } from '../../api/explorer-search-route';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	buildEntityHref,
	type AnalyticsCollection,
	type AnalyticsEntityPage,
	type ExplorerFilters
} from '../../api/explorer-analytics';
import {
	entityDescriptions,
	entityFields,
	titleCase,
	windowFields
} from './explorer-entity-config';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import {
	ExplorerEntityDetails,
	ExplorerEntityTable
} from './explorer-entity-table';
import { ExplorerContractActivity } from './explorer-contract-activity';
import { ExplorerBalanceObservations } from './explorer-balance-observations';
import {
	ExplorerEntityRequest,
	explorerPageHref,
	previousExplorerOffset
} from './explorer-entity-request';
import styles from './explorer-entity.module.css';

interface Props {
	readonly collection: AnalyticsCollection;
	readonly identifier?: string;
	readonly initialFilters: ExplorerFilters;
	readonly initialOffset?: number;
}
export function ExplorerEntityBrowser({
	collection,
	identifier,
	initialFilters,
	initialOffset = 0
}: Props): React.JSX.Element {
	const [filters, setFilters] = useState<ExplorerFilters>(initialFilters);
	const [mounted, setMounted] = useState(false);
	const [page, setPage] = useState<AnalyticsEntityPage | null>(null);
	const [submitted, setSubmitted] = useState<ExplorerFilters>(initialFilters);
	const [busy, setBusy] = useState(false),
		[error, setError] = useState<string | null>(null),
		[elapsed, setElapsed] = useState<number | null>(null);
	const [history, setHistory] = useState<number[]>([]);
	const currentOffset = useRef(0);
	const requests = useMemo(
		() => new ExplorerEntityRequest(collection, identifier),
		[collection, identifier]
	);
	const load = useCallback(
		async (
			nextFilters: ExplorerFilters,
			offset = 0,
			direction: 'reset' | 'next' | 'previous' = 'reset'
		) => {
			const started = performance.now();
			setBusy(true);
			setError(null);
			const previousOffset = currentOffset.current;
			const outcome = await requests.run({
				filters: nextFilters,
				offset,
				direction
			});
			if (!outcome) return;
			setBusy(false);
			if (outcome.ok) {
				const data = outcome.page;
				currentOffset.current = data.offset;
				setPage(data);
				const pinnedFilters = {
					...outcome.request.filters,
					min_ledger: String(data.window.minLedger),
					max_ledger: String(data.window.maxLedger)
				};
				setSubmitted(pinnedFilters);
				setElapsed(Math.round(performance.now() - started));
				setHistory((old) =>
					direction === 'reset'
						? []
						: direction === 'previous'
							? old.slice(0, -1)
							: [...old, previousOffset]
				);
				const url = explorerPageHref(
					collection,
					identifier,
					pinnedFilters,
					data.offset
				);
				window.history.replaceState(null, '', url);
			} else setError(outcome.message);
		},
		[collection, identifier, requests]
	);
	useEffect(() => {
		setMounted(true);
		void load(initialFilters, initialOffset);
		return () => requests.cancel();
	}, [load, initialFilters, initialOffset, requests]);
	const chosenWindow: ExplorerFilters = page
		? {
				min_ledger: String(page.window.minLedger),
				max_ledger: String(page.window.maxLedger)
			}
		: {};
	const row = page?.rows[0];
	const fields = identifier
		? windowFields
		: [...entityFields[collection], ...windowFields];
	return (
		<div className={styles.workspace}>
			<ExplorerEntityNavigation active={collection} />
			<section className={styles.panel} aria-busy={busy}>
				<div>
					<h2>
						{identifier
							? titleCase(collection).replace(/s$/, '') + ' ' + identifier
							: titleCase(collection)}
					</h2>
					<p className={styles.muted}>{entityDescriptions[collection]}</p>
				</div>
				{identifier && (
					<Link href={buildEntityHref(collection)}>← Browse {collection}</Link>
				)}
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void load(filters);
					}}
				>
					<div className={styles.form}>
						{fields.map((field) => (
							<label key={field.key}>
								{field.label}
								<input
									type={field.type ?? 'text'}
									placeholder={field.placeholder}
									value={
										field.type === 'datetime-local'
											? mounted
												? localTimeInput(filters[field.key] ?? '')
												: ''
											: (filters[field.key] ?? '')
									}
									onChange={(event) =>
										setFilters((previous) => ({
											...previous,
											[field.key]: event.currentTarget.value
										}))
									}
								/>
							</label>
						))}
					</div>
					<div className={styles.actions}>
						<button type="submit" disabled={busy}>
							{busy ? 'Loading…' : 'Apply filters'}
						</button>
						<button
							type="button"
							disabled={busy}
							onClick={() => {
								setFilters({});
								void load({});
							}}
						>
							Latest published
						</button>
					</div>
				</form>
				<p className={styles.muted}>
					Blank ledger bounds select the newest published window. An empty
					result is not evidence that the item never existed; historical
					ingestion is still in progress.
				</p>
				{busy && <p role="status">Loading {collection}…</p>}
				{error && (
					<div className={styles.error} role="alert">
						{error}{' '}
						<button
							type="button"
							disabled={busy}
							onClick={() => {
								const retry = requests.retryRequest;
								if (retry)
									void load(retry.filters, retry.offset, retry.direction);
							}}
						>
							Retry query
						</button>
					</div>
				)}
				{page && (
					<>
						{error && (
							<p role="status">
								Showing the last successful result; the requested update failed.
							</p>
						)}
						<div className={styles.status}>
							<span>
								Ledgers {page.window.minLedger.toLocaleString()}–
								{page.window.maxLedger.toLocaleString()}
							</span>
							<span>
								{page.coverageStatus === 'complete'
									? 'Selected window fully published'
									: 'Selected window has incomplete or unknown coverage'}
							</span>
							<span>{elapsed} ms</span>
						</div>
						{identifier && row ? (
							<ExplorerEntityDetails
								collection={collection}
								row={row}
								filters={chosenWindow}
							/>
						) : (
							<ExplorerEntityTable
								collection={collection}
								rows={page.rows}
								filters={chosenWindow}
							/>
						)}
						{(collection === 'trades' || collection === 'offers') && (
							<p className={styles.muted}>
								Amounts reflect the parsed dataset’s floating-point values.
								Price numerator and denominator are retained as exact integers.
							</p>
						)}
						{collection === 'liquidity-pools' && (
							<p className={styles.muted}>
								Reserves and shares retain source floating-point precision, not
								exact atomic units. Removed rows have no reserve snapshot; null
								does not mean zero. Repeated pool IDs represent separate
								observations. Pair-trade links include all venues.
							</p>
						)}
						{!identifier && (
							<div className={styles.actions}>
								<span>
									{page.rows.length
										? String(page.offset + 1) +
											'–' +
											String(page.offset + page.rows.length)
										: '0'}{' '}
									returned
								</span>
								<button
									disabled={busy || page.offset === 0}
									onClick={() =>
										void load(
											submitted,
											previousExplorerOffset(page.offset, page.limit, history),
											'previous'
										)
									}
								>
									Previous
								</button>
								<button
									disabled={busy || page.nextOffset === null}
									onClick={() =>
										void load(submitted, page.nextOffset ?? 0, 'next')
									}
								>
									Next
								</button>
							</div>
						)}
						{identifier && collection === 'contracts' && row && (
							<ExplorerContractActivity
								key={
									identifier +
									':' +
									String(page.window.minLedger) +
									':' +
									String(page.window.maxLedger)
								}
								contractId={identifier}
								filters={chosenWindow}
							/>
						)}
					</>
				)}
			</section>
			{identifier && collection === 'assets' && (
				<ExplorerBalanceObservations
					key={identifier}
					kind="holders"
					identifier={identifier}
				/>
			)}
		</div>
	);
}
