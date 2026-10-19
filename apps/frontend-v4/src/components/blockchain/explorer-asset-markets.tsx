'use client';

import { ExplorerLink as Link } from './explorer-investigation';
import { useEffect, useRef, useState } from 'react';
import {
	entityText,
	parseEntityPage,
	recordValue,
	requestExplorerJson,
	type EntityRecord,
	type AnalyticsEntityPage
} from '../../api/explorer-analytics';
import type { Asset } from './explorer-asset-types';
import { LocalDateTime } from '../local-date-time';
import styles from './explorer-entity.module.css';
import ui from './explorer-asset-workspace.module.css';
import { ExplorerPoolBrowser } from './explorer-pool-browser';
import { ExplorerAssetPair, usePairMetadata } from './explorer-asset-pair';
import { formatDecimal } from './explorer-format-values';

type View = 'trades' | 'liquidity-pools';
type Result = {
	rows: readonly EntityRecord[];
	pages: readonly AnalyticsEntityPage[];
	view: View;
};

function PairAsset({ value }: { value: unknown }): React.JSX.Element {
	const asset = recordValue(value);
	const id = entityText(asset, 'id');
	return (
		<Link href={'/explorer/assets/' + encodeURIComponent(id)} title={id}>
			{id === 'native' ? 'XLM' : entityText(asset, 'code') || id}
		</Link>
	);
}

/** Shows published observations, not an asserted current market inventory. */
export function ExplorerAssetMarkets({
	asset
}: {
	asset: Asset;
}): React.JSX.Element | null {
	const maximum = asset.lastObservedLedger ?? 2;
	const [view, setView] = useState<View>('trades');
	const [selection, setSelection] = useState<{
		view: View;
		min: string;
		max: string;
	}>({
		view: 'trades',
		min: String(Math.max(2, maximum - 2047)),
		max: String(maximum)
	});
	const [result, setResult] = useState<Result | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const generation = useRef(0);
	useEffect(() => {
		if (!selection || selection.view === 'liquidity-pools') return;
		const abort = new AbortController();
		const current = ++generation.current;
		setBusy(true);
		setError(null);
		const sides =
			selection.view === 'trades'
				? ['selling_asset', 'buying_asset']
				: ['asset_a', 'asset_b'];
		void Promise.all(
			sides.map(async (side) => {
				const params = new URLSearchParams({
					view: 'typed',
					[side]: asset.id,
					min_ledger: selection.min,
					max_ledger: selection.max,
					limit: '25'
				});
				if (selection.view === 'liquidity-pools')
					params.set('deleted', 'false');
				return parseEntityPage(
					await requestExplorerJson(
						'/v1/' + selection.view + '?' + params,
						abort.signal
					)
				);
			})
		)
			.then((pages) => {
				if (abort.signal.aborted || current !== generation.current) return;
				const seen = new Set<string>();
				const rows = pages
					.flatMap((page) => page.rows)
					.filter((row) => {
						const key =
							entityText(row, 'id') +
							':' +
							entityText(row, 'ledgerSequence') +
							':' +
							entityText(recordValue(row.sourceRecord), 'rowNumber');
						if (seen.has(key)) return false;
						seen.add(key);
						return true;
					})
					.sort((a, b) => Number(b.ledgerSequence) - Number(a.ledgerSequence));
				setResult({ rows, pages, view: selection.view });
			})
			.catch((cause: unknown) => {
				if (!abort.signal.aborted)
					setError(
						cause instanceof Error ? cause.message : 'Activity request failed.'
					);
			})
			.finally(() => {
				if (!abort.signal.aborted) setBusy(false);
			});
		return () => abort.abort();
	}, [selection, asset.id]);
	const pairMetadata = usePairMetadata(result?.rows ?? [], [
		'sellingAsset',
		'buyingAsset'
	]);
	if (asset.kind === 'contract') return null;
	return (
		<section
			className={ui.holderSection}
			aria-label="Asset trading activity"
			aria-busy={busy}
		>
			<div className={ui.sectionHeading}>
				<h3>Trading activity</h3>
				<span
					className={ui.observationLabel}
					title="Published trade executions and pool changes. These are historical observations, not a complete current liquidity inventory."
				>
					Historical observations ⓘ
				</span>
			</div>
			<form
				className={ui.holderControls}
				onSubmit={(event) => {
					event.preventDefault();
					setSelection({
						view,
						min: String(Math.max(2, maximum - 2047)),
						max: String(maximum)
					});
				}}
			>
				<label>
					View
					<select
						value={view}
						onChange={(event) => {
							const next = event.currentTarget.value as View;
							setView(next);
							setSelection((current) => ({ ...current, view: next }));
						}}
					>
						<option value="trades">Trades</option>
						<option value="liquidity-pools">Liquidity pools</option>
					</select>
				</label>
				<button
					disabled={busy || Number(selection.min) <= 2}
					type="button"
					onClick={() =>
						setSelection((current) => ({
							...current,
							min: String(Math.max(2, Number(current.min) - 2048)),
							max: String(Math.max(2, Number(current.min) - 1))
						}))
					}
				>
					Earlier activity
				</button>
				<button disabled={busy} type="submit">
					Latest indexed activity
				</button>
			</form>
			{error && (
				<p className={styles.error} role="alert">
					{error}
				</p>
			)}
			{view === 'liquidity-pools' && (
				<ExplorerPoolBrowser asset={asset.id} embedded />
			)}
			{view === 'trades' && result && (
				<>
					<div className={ui.holderSummary}>
						<span>{result.rows.length} observations</span>
						<span>
							{result.pages.some((page) => page.coverageStatus !== 'complete')
								? 'Partial history'
								: 'Selected range indexed'}
						</span>
					</div>
					<div className={styles.tableWrap}>
						<table className={styles.table}>
							<thead>
								<tr>
									<th>Pair</th>
									<th>
										{result.view === 'trades'
											? 'Sold → bought'
											: 'Pool reserves'}
									</th>
									<th>{result.view === 'trades' ? 'Operation' : 'Pool'}</th>
									<th>Ledger</th>
									<th>Time</th>
									<th>Report</th>
								</tr>
							</thead>
							<tbody>
								{result.rows.map((row, index) => (
									<tr key={entityText(row, 'id') + ':' + index}>
										<td>
											<ExplorerAssetPair
												a={row.sellingAsset}
												b={row.buyingAsset}
												metadata={pairMetadata}
											/>
										</td>
										<td className={ui.numeric}>
											{entityText(
												row,
												result.view === 'trades' ? 'sellingAmount' : 'reserveA'
											)}{' '}
											{result.view === 'trades' ? '→' : '/'}{' '}
											{entityText(
												row,
												result.view === 'trades' ? 'buyingAmount' : 'reserveB'
											)}
										</td>
										<td>
											<Link
												className={styles.hash}
												href={
													result.view === 'trades'
														? '/explorer/operations/' +
															entityText(row, 'operationId')
														: '/explorer/liquidity-pools/' +
															entityText(row, 'id') +
															'?min_ledger=' +
															entityText(row, 'ledgerSequence') +
															'&max_ledger=' +
															entityText(row, 'ledgerSequence')
												}
											>
												{entityText(
													row,
													result.view === 'trades' ? 'operationId' : 'id'
												)}
											</Link>
										</td>
										<td>
											<Link
												href={
													'/explorer/ledgers/' +
													entityText(row, 'ledgerSequence')
												}
											>
												{Number(row.ledgerSequence).toLocaleString()}
											</Link>
										</td>
										<td>
											{typeof row.closedAt === 'string' && (
												<LocalDateTime dateTime={row.closedAt} />
											)}
										</td>
										<td>
											<Link
												href={
													'/explorer/markets?' +
													new URLSearchParams({
														asset_a: entityText(
															recordValue(row.sellingAsset),
															'id'
														),
														asset_b: entityText(
															recordValue(row.buyingAsset),
															'id'
														),
														min_ledger: String(
															result.pages[0]!.window.minLedger
														),
														max_ledger: String(
															result.pages[0]!.window.maxLedger
														)
													})
												}
											>
												Pair report
											</Link>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{result.rows.length === 0 && (
						<p className={styles.muted}>No observations in this range.</p>
					)}
					<div className={styles.actions}>
						{result.pages.map((page, side) => (
							<Link
								key={side}
								href={
									'/explorer/' +
									result.view +
									'?' +
									new URLSearchParams({
										[result.view === 'trades'
											? side === 0
												? 'selling_asset'
												: 'buying_asset'
											: side === 0
												? 'asset_a'
												: 'asset_b']: asset.id,
										min_ledger: String(page.window.minLedger),
										max_ledger: String(page.window.maxLedger)
									})
								}
							>
								Browse {side === 0 ? 'sell side' : 'buy side'}
							</Link>
						))}
					</div>
				</>
			)}
		</section>
	);
}
