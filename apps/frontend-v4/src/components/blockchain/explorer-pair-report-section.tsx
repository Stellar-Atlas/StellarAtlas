'use client';
import { useEffect, useRef, useState } from 'react';
import { ExplorerLink as Link } from './explorer-investigation';
import { ExplorerEntityTable } from './explorer-entity-table';
import { LocalDateTime } from '../local-date-time';
import { formatDecimal } from './explorer-format-values';
import {
	buildEntityHref,
	entityText,
	parseEntityPage,
	requestExplorerJson,
	type AnalyticsEntityPage
} from '../../api/explorer-analytics';
import {
	pairReportApiPath,
	type PairReportLane,
	type PairReportSelection
} from '../../api/explorer-pair-report';
import styles from './explorer-entity.module.css';
import ui from './explorer-pair-report.module.css';
const symbol = (asset: string): string =>
	asset === 'native' ? 'XLM' : asset.split(':')[0]!;

export function PairReportSection({
	lane,
	selection,
	initialPage
}: {
	readonly lane: PairReportLane;
	readonly selection: PairReportSelection;
	readonly initialPage: AnalyticsEntityPage;
}): React.JSX.Element {
	const [page, setPage] = useState(initialPage),
		[busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [history, setHistory] = useState<number[]>([]);
	const abort = useRef<AbortController | null>(null);
	useEffect(() => () => abort.current?.abort(), []);
	const pool = lane.startsWith('pool');
	const reversed = lane === 'b-to-a' || lane === 'pool-b-a';
	const a = reversed ? selection.assetB : selection.assetA,
		b = reversed ? selection.assetA : selection.assetB;
	const filters = {
		min_ledger: selection.minLedger!,
		max_ledger: selection.maxLedger!
	};
	const title = pool
		? 'Native pools · ' + symbol(a) + ' / ' + symbol(b)
		: symbol(a) + ' → ' + symbol(b);
	const load = async (offset: number, previous: boolean) => {
		abort.current?.abort();
		const current = new AbortController();
		abort.current = current;
		setBusy(true);
		setError(null);
		try {
			const next = parseEntityPage(
				await requestExplorerJson(
					pairReportApiPath(selection, lane, offset),
					current.signal
				)
			);
			if (current.signal.aborted) return;
			if (
				String(next.window.minLedger) !== selection.minLedger ||
				String(next.window.maxLedger) !== selection.maxLedger
			)
				throw new Error('The returned window did not match the report.');
			setHistory((old) =>
				previous ? old.slice(0, -1) : [...old, page.offset]
			);
			setPage(next);
			const url = new URL(window.location.href);
			url.searchParams.set(lane + '_offset', String(next.offset));
			window.history.replaceState(null, '', url.pathname + url.search);
		} catch (cause: unknown) {
			if (!current.signal.aborted)
				setError(cause instanceof Error ? cause.message : 'Page unavailable.');
		} finally {
			if (!current.signal.aborted) setBusy(false);
		}
	};
	return (
		<section className={styles.panel} aria-label={title} aria-busy={busy}>
			<div className={ui.heading}>
				<h3>{title}</h3>
				<a
					href={
						'https://api.stellaratlas.io' +
						pairReportApiPath(selection, lane, page.offset)
					}
					target="_blank"
					rel="noreferrer"
				>
					JSON ↗
				</a>
			</div>
			<div className={styles.status}>
				<span>
					{page.rows.length} {pool ? 'observations' : 'trades'} shown
					{page.nextOffset !== null ? ' · More available' : ''}
				</span>
				{pool && (
					<span>
						{new Set(page.rows.map((row) => entityText(row, 'id'))).size}{' '}
						distinct pools on this page
					</span>
				)}
				<span>
					{page.coverageStatus === 'complete'
						? 'Window published'
						: 'Partial history'}
				</span>
			</div>
			{error && (
				<p role="alert" className={styles.error}>
					{error}
				</p>
			)}
			{!pool ? (
				<ExplorerEntityTable
					collection="trades"
					rows={page.rows}
					filters={filters}
				/>
			) : (
				<div className={styles.tableWrap}>
					<table className={styles.table}>
						<thead>
							<tr>
								{[
									'Pool',
									'Reserve ' + symbol(a),
									'Reserve ' + symbol(b),
									'Share trustlines',
									'Ledger / time'
								].map((label) => (
									<th scope="col" key={label}>
										{label}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{page.rows.map((row, index) => (
								<tr key={entityText(row, 'id') + ':' + index}>
									<td data-label="Pool">
										<Link
											className={styles.hash}
											href={buildEntityHref(
												'liquidity-pools',
												entityText(row, 'id'),
												{
													min_ledger: entityText(row, 'ledgerSequence'),
													max_ledger: entityText(row, 'ledgerSequence')
												}
											)}
										>
											{entityText(row, 'id')}
										</Link>
									</td>
									<td
										data-label={'Reserve ' + symbol(a)}
										className={ui.numeric}
									>
										{row.reserveA == null
											? '—'
											: formatDecimal(entityText(row, 'reserveA'))}
									</td>
									<td
										data-label={'Reserve ' + symbol(b)}
										className={ui.numeric}
									>
										{row.reserveB == null
											? '—'
											: formatDecimal(entityText(row, 'reserveB'))}
									</td>
									<td data-label="Share trustlines" className={ui.numeric}>
										{row.trustlineCount == null
											? '—'
											: formatDecimal(entityText(row, 'trustlineCount'), 0)}
									</td>
									<td data-label="Ledger / time">
										<Link
											href={buildEntityHref(
												'ledgers',
												entityText(row, 'ledgerSequence')
											)}
										>
											{Number(row.ledgerSequence).toLocaleString('en-US')}
										</Link>
										<div className={styles.muted}>
											<LocalDateTime dateTime={entityText(row, 'closedAt')} />
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
					{page.rows.length === 0 && (
						<p className={styles.empty}>
							No matching pool observations in the published range.
						</p>
					)}
				</div>
			)}
			<div className={styles.actions}>
				<span>Page {Math.floor(page.offset / page.limit) + 1}</span>
				<button
					disabled={busy || page.offset === 0}
					onClick={() =>
						void load(
							history.at(-1) ?? Math.max(0, page.offset - page.limit),
							true
						)
					}
				>
					Previous
				</button>
				<button
					disabled={busy || page.nextOffset === null}
					onClick={() => void load(page.nextOffset ?? 0, false)}
				>
					Next
				</button>
				{busy && <span role="status">Loading…</span>}
			</div>
		</section>
	);
}
