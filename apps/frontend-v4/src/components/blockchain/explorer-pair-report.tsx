'use client';

import { useEffect, useRef, useState } from 'react';
import { ExplorerLink as Link } from './explorer-investigation';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import { PairReportSection } from './explorer-pair-report-section';
import {
	requestExplorerJson,
	type ExplorerFilters
} from '../../api/explorer-analytics';
import {
	loadPairReport,
	validatePairReportSelection,
	type PairReportLane,
	type PairReportSelection
} from '../../api/explorer-pair-report';
import styles from './explorer-entity.module.css';
import ui from './explorer-pair-report.module.css';

const lanes: readonly PairReportLane[] = [
	'a-to-b',
	'b-to-a',
	'pool-a-b',
	'pool-b-a'
];
type Report = Awaited<ReturnType<typeof loadPairReport>>;

function reportHref(
	selection: PairReportSelection,
	offsets: Partial<Readonly<Record<PairReportLane, number>>> = {}
): string {
	const params = new URLSearchParams({
		asset_a: selection.assetA,
		asset_b: selection.assetB,
		min_ledger: selection.minLedger ?? '',
		max_ledger: selection.maxLedger ?? '',
		limit: selection.limit
	});
	for (const lane of lanes)
		if (offsets[lane]) params.set(lane + '_offset', String(offsets[lane]));
	return '/explorer/markets?' + params;
}

export function ExplorerPairReport({
	initialFilters
}: {
	readonly initialFilters: ExplorerFilters;
}): React.JSX.Element {
	const [draft, setDraft] = useState<PairReportSelection>({
		assetA: initialFilters.asset_a ?? '',
		assetB: initialFilters.asset_b ?? '',
		minLedger: initialFilters.min_ledger ?? '',
		maxLedger: initialFilters.max_ledger ?? '',
		limit: initialFilters.limit ?? '25'
	});
	const [selection, setSelection] = useState<PairReportSelection | null>(
		initialFilters.asset_a && initialFilters.asset_b ? draft : null
	);
	const [report, setReport] = useState<Report | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const controller = useRef<AbortController | null>(null);
	const initialOffsets = useRef(
		Object.fromEntries(
			lanes.map((lane) => {
				const value = Number(initialFilters[lane + '_offset'] ?? 0);
				return [
					lane,
					Number.isSafeInteger(value) && value >= 0 && value <= 10000
						? value
						: 0
				];
			})
		) as Record<PairReportLane, number>
	);
	useEffect(() => {
		if (!selection) return;
		const abort = new AbortController();
		controller.current = abort;
		setBusy(true);
		setError(null);
		setReport(null);
		void (async () => {
			const result = await loadPairReport(
				validatePairReportSelection(selection),
				abort.signal,
				requestExplorerJson,
				initialOffsets.current
			);
			if (abort.signal.aborted) return;
			setReport(result);
			setDraft(result.selection);
			window.history.replaceState(
				null,
				'',
				reportHref(result.selection, initialOffsets.current)
			);
		})()
			.catch((cause: unknown) => {
				if (!abort.signal.aborted)
					setError(
						cause instanceof Error ? cause.message : 'Report unavailable.'
					);
			})
			.finally(() => {
				if (!abort.signal.aborted) setBusy(false);
			});
		return () => abort.abort();
	}, [selection]);
	const run = () => {
		try {
			const next = validatePairReportSelection(draft);
			initialOffsets.current = {
				'a-to-b': 0,
				'b-to-a': 0,
				'pool-a-b': 0,
				'pool-b-a': 0
			};
			setSelection(next);
		} catch (cause: unknown) {
			setError(
				cause instanceof Error ? cause.message : 'Check the report filters.'
			);
		}
	};
	return (
		<div className={styles.workspace}>
			<ExplorerEntityNavigation active="markets" />
			<section className={styles.panel} aria-busy={busy}>
				<div className={ui.heading}>
					<div>
						<h2>Historical pair report</h2>
						<p className={styles.muted}>
							Trades in both directions and native-pool observations.
						</p>
					</div>
					<Link href="/docs/rest#historical-pair-report">
						API &amp; GraphQL examples
					</Link>
				</div>
				<form
					className={styles.filterForm}
					onSubmit={(event) => {
						event.preventDefault();
						run();
					}}
				>
					<div className={styles.form}>
						<label>
							Asset A
							<input
								required
								value={draft.assetA}
								placeholder="CODE:ISSUER or XLM"
								onChange={(event) =>
									setDraft({ ...draft, assetA: event.target.value })
								}
							/>
						</label>
						<label>
							Asset B
							<input
								required
								value={draft.assetB}
								placeholder="CODE:ISSUER or XLM"
								onChange={(event) =>
									setDraft({ ...draft, assetB: event.target.value })
								}
							/>
						</label>
					</div>
					<details
						className={styles.rangeFilters}
						open={Boolean(draft.minLedger || draft.maxLedger)}
					>
						<summary>
							Historical ledger range{' '}
							<span>Latest published window by default</span>
						</summary>
						<div className={styles.form}>
							<label>
								First ledger
								<input
									type="number"
									min="2"
									value={draft.minLedger ?? ''}
									onChange={(event) =>
										setDraft({ ...draft, minLedger: event.target.value })
									}
								/>
							</label>
							<label>
								Last ledger
								<input
									type="number"
									min="2"
									value={draft.maxLedger ?? ''}
									onChange={(event) =>
										setDraft({ ...draft, maxLedger: event.target.value })
									}
								/>
							</label>
						</div>
					</details>
					<div className={styles.filterToolbar}>
						<div className={styles.actions}>
							<button type="submit" disabled={busy}>
								Build report
							</button>
							{busy && (
								<button
									type="button"
									onClick={() => {
										controller.current?.abort();
										setBusy(false);
										setError('Report request cancelled.');
									}}
								>
									Cancel
								</button>
							)}
							<button
								type="button"
								disabled={busy}
								onClick={() =>
									setDraft({
										...draft,
										assetA: draft.assetB,
										assetB: draft.assetA
									})
								}
							>
								Swap assets
							</button>
						</div>
						<label className={styles.pageSize}>
							Rows per section
							<select
								value={draft.limit}
								onChange={(event) =>
									setDraft({ ...draft, limit: event.target.value })
								}
							>
								{['10', '25', '50', '100'].map((count) => (
									<option key={count}>{count}</option>
								))}
							</select>
						</label>
					</div>
				</form>
				{busy && <p role="status">Loading the report…</p>}
				{error && (
					<p className={styles.error} role="alert">
						{error}
					</p>
				)}
				{report && (
					<>
						<div className={ui.scope}>
							<strong>
								Ledgers{' '}
								{Number(report.selection.minLedger).toLocaleString('en-US')}–
								{Number(report.selection.maxLedger).toLocaleString('en-US')}
							</strong>
							<span>
								{lanes.every(
									(lane) => report.pages[lane].coverageStatus === 'complete'
								)
									? 'Selected window published'
									: 'Partial or unknown historical coverage'}
							</span>
						</div>
						<p className={styles.muted}>
							Historical records, not live market depth. Amounts retain source
							floating-point precision. Each section is paginated; shown rows
							are not total market volume.
						</p>
					</>
				)}
			</section>
			{report &&
				lanes.map((lane) => (
					<PairReportSection
						key={reportHref(report.selection) + lane}
						lane={lane}
						selection={report.selection}
						initialPage={report.pages[lane]}
					/>
				))}
		</div>
	);
}
