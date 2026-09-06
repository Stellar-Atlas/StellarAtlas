'use client';
import Link from 'next/link';
import {
	localTimeInput,
	normalizeExplorerTimes
} from '../../api/explorer-search-route';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	buildEntityApiPath,
	buildEntityHref,
	parseEntityPage,
	requestExplorerJson,
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
import styles from './explorer-entity.module.css';

interface Props {
	readonly collection: AnalyticsCollection;
	readonly identifier?: string;
	readonly initialFilters: ExplorerFilters;
}
export function ExplorerEntityBrowser({
	collection,
	identifier,
	initialFilters
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
	const requestId = useRef(0),
		controller = useRef<AbortController | null>(null);
	const load = useCallback(
		async (
			nextFilters: ExplorerFilters,
			offset = 0,
			direction: 'reset' | 'next' | 'previous' = 'reset'
		) => {
			controller.current?.abort();
			const abort = new AbortController(),
				id = ++requestId.current;
			controller.current = abort;
			const timeout = setTimeout(() => abort.abort(), 25000),
				started = performance.now();
			setBusy(true);
			setError(null);
			try {
				nextFilters = normalizeExplorerTimes(nextFilters);
				const previousOffset = currentOffset.current;
				const data = parseEntityPage(
					await requestExplorerJson(
						buildEntityApiPath(collection, identifier, nextFilters, offset),
						abort.signal
					)
				);
				if (id !== requestId.current) return;
				currentOffset.current = data.offset;
				setPage(data);
				const pinnedFilters = {
					...nextFilters,
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
				const url = buildEntityHref(collection, identifier, pinnedFilters);
				window.history.replaceState(null, '', url);
			} catch (failure) {
				if (id !== requestId.current) return;
				setError(
					abort.signal.aborted
						? 'The query timed out. Narrow the ledger range and try again.'
						: failure instanceof Error
							? failure.message
							: 'The data service could not complete this query.'
				);
			} finally {
				clearTimeout(timeout);
				if (id === requestId.current) {
					setBusy(false);
					controller.current = null;
				}
			}
		},
		[collection, identifier]
	);
	useEffect(() => {
		setMounted(true);
		void load(initialFilters);
		return () => controller.current?.abort();
	}, [load, initialFilters]);
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
						<button type="button" onClick={() => void load(submitted)}>
							Retry query
						</button>
					</div>
				)}
				{page && (
					<>
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
									disabled={busy || history.length === 0}
									onClick={() =>
										void load(submitted, history.at(-1) ?? 0, 'previous')
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
		</div>
	);
}
