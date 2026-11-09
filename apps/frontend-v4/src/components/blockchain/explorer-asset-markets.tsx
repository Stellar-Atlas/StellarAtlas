'use client';

import { ExplorerLink as Link } from './explorer-investigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
	entityText,
	parseEntityPage,
	recordValue,
	requestExplorerJson,
	type EntityRecord,
	type AnalyticsEntityPage
} from '../../api/explorer-analytics';
import type { Asset } from './explorer-asset-types';
import styles from './explorer-entity.module.css';
import ui from './explorer-asset-workspace.module.css';
import { ExplorerPoolBrowser } from './explorer-pool-browser';
import { ExplorerAssetTradeTable } from './explorer-asset-trade-table';
import { ExplorerAssetMarketPairs } from './explorer-asset-market-pairs';
import { assetMarketRouteHref, assetTradeSideHref, defaultAssetMarketRoute, readAssetMarketRoute, type AssetMarketRoute } from './asset-market-route';

type View = 'trades' | 'liquidity-pools';
type TradeSide = 'selling_asset' | 'buying_asset';
type TradePreview = {
	rows: readonly EntityRecord[];
	pages: readonly [AnalyticsEntityPage | null, AnalyticsEntityPage | null];
	window: AnalyticsEntityPage['window'];
	unavailable: { side: 'Buy' | 'Sell'; message: string } | null;
};
type Result = TradePreview & { assetId: string };

function tradeFailure(reason: unknown): string {
	return reason instanceof Error ? reason.message : 'Trade request failed.';
}

export async function loadAssetTradePreview(
	loadSide: (side: TradeSide) => Promise<AnalyticsEntityPage>
): Promise<TradePreview> {
	const [sell, buy] = await Promise.allSettled([loadSide('selling_asset'), loadSide('buying_asset')]);
	if (sell.status === 'rejected' && buy.status === 'rejected') throw new Error(tradeFailure(sell.reason));
	const sellPage = sell.status === 'fulfilled' ? sell.value : null;
	const buyPage = buy.status === 'fulfilled' ? buy.value : null;
	const window = (sellPage ?? buyPage)?.window;
	if (!window) throw new Error('Trade ledger window unavailable.');
	if (sellPage && buyPage && (buyPage.window.minLedger !== window.minLedger || buyPage.window.maxLedger !== window.maxLedger))
		throw new Error('Trade sides returned different ledger ranges. Try again.');
	const pages = [sellPage, buyPage] as const;
	const seen = new Set<string>();
	const rows = pages.flatMap((page) => page?.rows ?? []).filter((row) => {
		const key = entityText(row, 'id') + ':' + entityText(row, 'ledgerSequence') + ':' +
			entityText(recordValue(row.sourceRecord), 'rowNumber');
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	}).sort((a, b) => Number(b.ledgerSequence) - Number(a.ledgerSequence));
	const unavailable = sell.status === 'rejected' ? { side: 'Sell' as const, message: tradeFailure(sell.reason) }
		: buy.status === 'rejected' ? { side: 'Buy' as const, message: tradeFailure(buy.reason) } : null;
	return { pages, window, rows, unavailable };
}

/** Shows published observations, not an asserted current market inventory. */
export function ExplorerAssetMarkets({
	asset
}: {
	asset: Asset;
}): React.JSX.Element | null {
	const maximum = asset.lastObservedLedger ?? 2;
	const pathname = usePathname();
	const params = useSearchParams();
	const origin = pathname + (params.size ? '?' + params.toString() : '');
	const { view, min, max } = readAssetMarketRoute(params, maximum);
	const selection = useMemo(() => ({ view, min, max }), [view, min, max]);
	const [refresh, setRefresh] = useState(0);
	const navigate = (next: AssetMarketRoute) => {
		const href = assetMarketRouteHref(pathname, window.location.search, next, maximum, window.location.hash);
		if (href !== window.location.pathname + window.location.search + window.location.hash)
			window.history.pushState(null, '', href);
		else if (next.view === 'trades') setRefresh(value => value + 1);
	};
	const [loaded, setResult] = useState<Result | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const generation = useRef(0);
	useEffect(() => {
		if (selection.view === 'liquidity-pools') {
			setBusy(false);
			setError(null);
			return;
		}
		const abort = new AbortController();
		const current = ++generation.current;
		setBusy(true);
		setError(null);
		const loadSide = async (side: TradeSide) => {
			const params = new URLSearchParams({
				view: 'typed',
				[side]: asset.id,
				min_ledger: selection.min,
				max_ledger: selection.max,
				limit: '25'
			});
			return parseEntityPage(await requestExplorerJson('/v1/trades?' + params, abort.signal));
		};
		void loadAssetTradePreview(loadSide)
			.then((preview) => {
				if (abort.signal.aborted || current !== generation.current) return;
				setResult({ assetId: asset.id, ...preview });
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
	}, [selection, asset.id, refresh]);
	const result = loaded?.assetId === asset.id ? loaded : null;
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
					navigate(defaultAssetMarketRoute(maximum));
				}}
			>
				<label>
					View
					<select
						value={view}
						onChange={(event) => {
							const next = event.currentTarget.value as View;
							navigate({ ...selection, view: next });
						}}
					>
						<option value="trades">Trades</option>
						<option value="liquidity-pools">Liquidity pools</option>
					</select>
				</label>
				{view === 'trades' && <><button
					disabled={busy || Number(selection.min) <= 2}
					type="button"
					onClick={() =>
						navigate({
							...selection,
							min: String(Math.max(2, Number(selection.min) - 2048)),
							max: String(Math.max(2, Number(selection.min) - 1))
						})
					}
				>
					Earlier activity
				</button>
				<button disabled={busy} type="submit">
					Latest asset window
				</button>
				</>}
			</form>
			{view === 'trades' && busy && (
				<p className={styles.muted} role="status">
					Loading trades…{result ? ' Showing previous results.' : ''}
				</p>
			)}
			{error && (
				<p className={styles.error} role="alert">
					{error}
					{view === 'trades' && result ? ' Showing previous results.' : ''}
				</p>
			)}
			{view === 'liquidity-pools' && (
				<ExplorerPoolBrowser asset={asset.id} embedded />
			)}
			{view === 'trades' && result && (
				<>
					<div className={ui.holderSummary}>
						<span>{result.rows.length} {result.rows.length === 1 ? 'observation' : 'observations'} in preview</span>
						<span title="Returned trade window; the latest default is anchored to the asset’s last observed ledger, not a live-market watermark.">
							Trade ledgers {result.window.minLedger.toLocaleString('en-US')}–{result.window.maxLedger.toLocaleString('en-US')}
						</span>
						<span>
							{result.pages.some((page) => page && page.coverageStatus !== 'complete')
								? 'Partial history'
								: result.unavailable ? 'Loaded side: selected range indexed' : 'Selected range indexed'}
						</span>
					</div>
					{result.unavailable ? (
						<p role="status" className={styles.muted}>
							{result.unavailable.side}-side trades unavailable. Showing the other side only. {result.unavailable.message}
						</p>
					) : <ExplorerAssetMarketPairs asset={asset.id} origin={origin} rows={result.rows} window={result.window} />}
					<p className={styles.muted}>
						{result.unavailable ? 'Preview: up to 25 trades on the loaded side.' : 'Preview: up to 25 trades per side. Browse either side for more.'}
					</p>
					<div className={styles.actions}>
						{result.pages.map((page, side) => page && (
							<Link
								key={side}
								href={assetTradeSideHref(asset.id, side === 0 ? 'sell' : 'buy', page.window, origin)}
							>
								Browse {side === 0 ? 'sell-side' : 'buy-side'} trades
							</Link>
						))}
					</div>
					<ExplorerAssetTradeTable asset={asset.id} origin={origin} rows={result.rows} window={result.window} />
					<p className={styles.muted} title="Parsed trade amounts are floating-point observations, not exact raw-unit amounts.">Amounts: source Float64 precision.</p>
					{result.rows.length === 0 && (
						<p className={styles.muted}>{result.unavailable ? 'No observations on the loaded side.' : 'No observations in this range.'}</p>
					)}

				</>
			)}
		</section>
	);
}
