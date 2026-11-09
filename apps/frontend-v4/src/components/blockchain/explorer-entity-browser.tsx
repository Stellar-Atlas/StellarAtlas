'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ExplorerInvestigationScope, useExplorerReturnTo } from './explorer-investigation';
import { withExplorerReturnTo } from '../../api/explorer-return-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	buildEntityHref,
	type AnalyticsCollection,
	type AnalyticsEntityPage,
	type ExplorerFilters
} from '../../api/explorer-analytics';
import { entityDescriptions, titleCase } from './explorer-entity-config';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import { ExplorerEntityFilters } from './explorer-entity-filters';
import { ExplorerEntityContext } from './explorer-entity-context';
import {
	ExplorerEntityDetails,
	ExplorerEntityTable
} from './explorer-entity-table';
import { ExplorerContractActivity } from './explorer-contract-activity';
import { contractIdentityFilters, preserveContractActivityContext } from './contract-state-route';
import { ExplorerContractProvenance } from './explorer-contract-provenance';
import { verifiedContractsPath } from '../../api/verified-contract-catalogue';
import { ExplorerBalanceObservations } from './explorer-balance-observations';
import {
	ExplorerEntityRequest,
	explorerPageHref,
	explorerSelectionKey,
	readExplorerPageSelection,
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
	return <EntityBrowser key={JSON.stringify([collection, identifier, initialFilters, initialOffset])}
		collection={collection} identifier={identifier} initialFilters={initialFilters} initialOffset={initialOffset} />;
}

function EntityBrowser({
	collection,
	identifier,
	initialFilters,
	initialOffset = 0
}: Props): React.JSX.Element {
	const returnTo = useExplorerReturnTo();
	const params = useSearchParams();
	const search = params?.toString() ?? null;
	const selection = useMemo(() => {
		const next = readExplorerPageSelection(search, initialFilters, initialOffset, !!identifier);
		return collection === 'contracts' && identifier ? { ...next, filters: contractIdentityFilters(next.filters) } : next;
	}, [search, initialFilters, initialOffset, identifier, collection]);
	const selectionKey = explorerSelectionKey(selection.filters, selection.offset);
	const acceptedSelection = useRef<string | null>(null);
	const loadRevision = useRef(0);
	const [filters, setFilters] = useState<ExplorerFilters>(initialFilters);
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
	useEffect(() => () => requests.cancel(), [requests]);
	const load = useCallback(
		async (
			nextFilters: ExplorerFilters,
			offset = 0,
			direction: 'reset' | 'next' | 'previous' = 'reset',
			historyMode: 'push' | 'replace' = 'push'
		) => {
			const revision = ++loadRevision.current;
			const navigationOrigin = window.location.pathname + window.location.search;
			const started = performance.now();
			setBusy(true);
			setError(null);
			const previousOffset = currentOffset.current;
			const outcome = await requests.run({
				filters: nextFilters,
				offset,
				direction
			});
			// Back can change the URL before React invalidates this request. Apply
			// also launches from the current URL, not its eventual target URL.
			if (!outcome || revision !== loadRevision.current || navigationOrigin !== window.location.pathname + window.location.search) return;
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
				acceptedSelection.current = explorerSelectionKey(pinnedFilters, data.offset);
				setElapsed(Math.round(performance.now() - started));
				setHistory((old) =>
					direction === 'reset'
						? []
						: direction === 'previous'
							? old.slice(0, -1)
								: [...old, previousOffset].slice(-50)
				);
				const url = explorerPageHref(
					collection,
					identifier,
					pinnedFilters,
					data.offset,
					returnTo
				);
				const destination = collection === 'contracts' && identifier ? preserveContractActivityContext(url, window.location.search) : url;
				const href = withExplorerReturnTo(destination, returnTo) + window.location.hash;
				if (href !== window.location.pathname + window.location.search + window.location.hash) {
					if (historyMode === 'push') window.history.pushState(null, '', href);
					else window.history.replaceState(null, '', href);
				}
			} else setError(outcome.message);
		},
		[collection, identifier, requests, returnTo]
	);
	useEffect(() => {
		if (acceptedSelection.current === selectionKey) {
			// Back A may still be pending when Forward returns to accepted B.
			// Restoring B must invalidate A even though no new fetch is needed.
			loadRevision.current++;
			requests.cancel();
			setBusy(false);
			setError(null);
			setFilters(selection.filters);
			return;
		}
		setFilters(selection.filters);
		void load(selection.filters, selection.offset, 'reset', 'replace');
	}, [load, requests, selectionKey, selection.filters, selection.offset]);
	const chosenWindow: ExplorerFilters = page
		? {
				min_ledger: String(page.window.minLedger),
				max_ledger: String(page.window.maxLedger)
			}
		: {};
	const row = page?.rows[0];
	const operationDetail = collection === 'operations' && Boolean(identifier);
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
					{!operationDetail && <p className={styles.muted}>{entityDescriptions[collection]}</p>}
				</div>
				{identifier && (
					<Link href={buildEntityHref(collection)}>← Browse {collection}</Link>
				)}
				{!identifier && collection === 'contracts' && (
					<p><a href={verifiedContractsPath}>Browse verified contracts →</a></p>
				)}
				{identifier && collection === 'contracts' && (
					<ExplorerContractProvenance
						key={identifier}
						contractId={identifier}
					/>
				)}
				{!operationDetail && <><ExplorerEntityFilters
					collection={collection}
					identifier={identifier}
					filters={filters}
					busy={busy}
					onChange={setFilters}
					onApply={(next) => void load(next)}
				/>
				<p className={styles.muted}>
					Latest published activity by default. Date and ledger filters are
					optional.
				</p></>}
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
					<ExplorerInvestigationScope origin={returnTo ?? explorerPageHref(collection, identifier, submitted, page.offset)}>
						{error && (
							<p role="status">
								Showing the last successful result; the requested update failed.
							</p>
						)}
						{!operationDetail && <ExplorerEntityContext collection={collection} identifier={identifier} page={page} submitted={submitted} elapsed={elapsed} />}
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
									disabled={busy || !!error || page.offset === 0}
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
									disabled={busy || !!error || page.nextOffset === null}
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
					</ExplorerInvestigationScope>
				)}
				{operationDetail && <details className={styles.rangeFilters}>
					<summary>Request context</summary>
					{page && <ExplorerEntityContext collection={collection} identifier={identifier} page={page} submitted={submitted} elapsed={elapsed} sourceRecord />}
					<p className={styles.muted}>Ledger inferred from operation ID unless overridden.</p>
					<ExplorerEntityFilters collection={collection} identifier={identifier} filters={filters} busy={busy} operationDetail onChange={setFilters} onApply={next=>void load(next)} />
				</details>}
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
