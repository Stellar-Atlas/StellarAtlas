'use client';

import { useEffect, useRef, useState } from 'react';
import { requestExplorerJson } from '../../api/explorer-analytics';
import { marketHistoryPath, parseMarketHistory, type MarketHistory } from '../../api/explorer-market-history';
import type { PairReportSelection } from '../../api/explorer-pair-report';
import { ExplorerLink } from './explorer-investigation';
import styles from './explorer-entity.module.css';
import ui from './explorer-pair-report.module.css';

const utc = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
	hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
});
const compactAmount = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 8 });
const axisAmount = (value: number) => value < 1e-6 || value >= 1e9 ? value.toExponential(3) : compactAmount.format(value);
const assetCode = (id: string) => id === 'native' ? 'XLM' : id.split(':', 1)[0];
const timeText = (seconds: number) => utc.format(seconds * 1000);
function UtcTime({ seconds }: { readonly seconds: number }): React.JSX.Element {
	return <time dateTime={new Date(seconds * 1000).toISOString()}>{timeText(seconds)}</time>;
}

function MarketHistoryChart({ history, base, quote }: {
	readonly history: MarketHistory;
	readonly base: string;
	readonly quote: string;
}): React.JSX.Element | null {
	const { bins, resolution } = history;
	const first = bins[0]?.timestamp, last = bins.at(-1)?.timestamp;
	if (first === undefined || last === undefined) return null;
	const closes = bins.map(bin => Number(bin.close));
	const min = Math.min(...closes), max = Math.max(...closes);
	const maxVolume = Math.max(...bins.map(bin => Number(bin.baseVolume)));
	const slot = 600 / ((last - first) / resolution + 1);
	const x = (timestamp: number) => 20 + ((timestamp - first) / resolution + 0.5) * slot;
	const barWidth = Math.min(34, slot * 0.74);
	return <div className={ui.marketPlots}>
		<figure>
			<figcaption><strong>Closing price</strong><span>{quote} per {base}</span></figcaption>
			<div className={ui.axis} data-single-value={min === max}><span>{axisAmount(max)}</span>{min !== max && <span>{axisAmount(min)}</span>}</div>
			<svg viewBox="0 0 640 104" preserveAspectRatio="none" role="img" aria-label="Closing price by observed five-minute bin. Values are listed below.">
				<line className={ui.gridline} x1="20" x2="620" y1="12" y2="12" />
				<line className={ui.gridline} x1="20" x2="620" y1="92" y2="92" />
				{bins.map((bin, index) => <circle className={ui.closePoint} key={bin.timestamp} cx={x(bin.timestamp)}
					cy={max === min ? 52 : 92 - 80 * ((closes[index]! - min) / (max - min))} r="3" />)}
			</svg>
		</figure>
		<figure>
			<figcaption><strong>Traded volume</strong><span>{base}</span></figcaption>
			<div className={ui.axis}><span>{axisAmount(maxVolume)}</span><span>0</span></div>
			<svg viewBox="0 0 640 104" preserveAspectRatio="none" role="img" aria-label="Base asset volume by observed five-minute bin. Values are listed below.">
				<line className={ui.gridline} x1="20" x2="620" y1="92" y2="92" />
				{bins.map(bin => {
					const height = 80 * (Number(bin.baseVolume) / maxVolume);
					return <rect className={ui.volumeBar} key={bin.timestamp} x={x(bin.timestamp) - barWidth / 2} y={92 - height} width={barWidth} height={height} />;
				})}
			</svg>
		</figure>
		<p className={ui.chartDates}><UtcTime seconds={first} />{first !== last && <UtcTime seconds={last} />}</p>
	</div>;
}

export function MarketHistoryContent({ history, selection }: {
	readonly history: MarketHistory;
	readonly selection: PairReportSelection;
}): React.JSX.Element {
	const base = assetCode(selection.assetA), quote = assetCode(selection.assetB);
	return <>
		{history.hasPublishedSource && history.to > history.from &&
			<p className={styles.muted}>Requested time window: <UtcTime seconds={history.from} /> – <UtcTime seconds={history.to} /> (end exclusive).</p>}
		{!history.ledgerRangeComplete && <p className={styles.muted}>Ledger coverage is partial; trades may be missing.</p>}
		{history.hasPublishedSource && !history.timeRangeComplete &&
			<p className={styles.muted}>The time window extends beyond the published source bounds.</p>}
		{history.asOf !== null && <p className={styles.muted}>Last included trade: <UtcTime seconds={history.asOf} /></p>}
		{history.bins.length === 0 ? <p role="status">{history.hasPublishedSource
			? 'No trades were found in the published data for this window.'
			: 'No published trade source was available for these ledgers.'}</p> : <>
			<MarketHistoryChart history={history} base={base} quote={quote} />
			<p className={styles.muted}>Five-minute bins. Gaps are omitted, not zero. Values use source precision.</p>
			<details>
				<summary>View {history.bins.length} observed {history.bins.length === 1 ? 'bin' : 'bins'}</summary>
				<div className={ui.historyValues} tabIndex={0} role="region" aria-label="Observed price and volume values">
					<table className={ui.historyTable}>
						<thead><tr>
							<th scope="col">Bin start (UTC)</th><th scope="col">Close ({quote}/{base})</th>
							<th scope="col">Volume ({base})</th><th scope="col">Volume ({quote})</th><th scope="col">Trades</th>
						</tr></thead>
						<tbody>{history.bins.map(bin => <tr key={bin.timestamp}>
							<th scope="row"><UtcTime seconds={bin.timestamp} /></th><td>{bin.close}</td>
							<td>{bin.baseVolume}</td><td>{bin.quoteVolume}</td><td>{bin.tradeCount.toLocaleString('en-US')}</td>
						</tr>)}</tbody>
					</table>
				</div>
			</details>
		</>}
	</>;
}

export function ExplorerMarketHistory({ selection }: {
	readonly selection: PairReportSelection;
}): React.JSX.Element {
	const [history, setHistory] = useState<MarketHistory | null>(null);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<{ readonly text: string; readonly error: boolean } | null>(null);
	const request = useRef<AbortController | null>(null);
	useEffect(() => () => request.current?.abort(), []);
	const load = async () => {
		if (request.current) return;
		const controller = new AbortController();
		request.current = controller;
		setMessage(null);
		setBusy(true);
		try {
			const result = parseMarketHistory(await requestExplorerJson(marketHistoryPath(selection), controller.signal), selection);
			if (!controller.signal.aborted) setHistory(result);
		} catch {
			if (!controller.signal.aborted) setMessage({ error: true, text: 'Price and volume unavailable. Retry or choose a shorter ledger range.' });
		} finally {
			if (request.current === controller) { request.current = null; setBusy(false); }
		}
	};
	return <section className={styles.panel} aria-label="Historical price and volume" aria-busy={busy}>
		<h2>Price and volume</h2>
		<p className={styles.muted}>Classic DEX and native AMM trades. No Soroban swaps.</p>
		<p className={ui.marketPair}>
			<span>Base <ExplorerLink href={'/explorer/assets/' + encodeURIComponent(selection.assetA)}>{selection.assetA === 'native' ? 'XLM' : selection.assetA}</ExplorerLink></span>
			<span>Quote <ExplorerLink href={'/explorer/assets/' + encodeURIComponent(selection.assetB)}>{selection.assetB === 'native' ? 'XLM' : selection.assetB}</ExplorerLink></span>
		</p>
		{!history && <div className={styles.actions}>
			<button type="button" disabled={busy} onClick={() => void load()}>{message?.error ? 'Retry price and volume' : 'Load price and volume'}</button>
			{busy && <button type="button" onClick={() => {
				request.current?.abort();
				request.current = null;
				setBusy(false);
				setMessage({ error: false, text: 'Price and volume request cancelled.' });
			}}>Cancel</button>}
		</div>}
		{busy && <p role="status">Loading price and volume…</p>}
		{message && <p role={message.error ? 'alert' : 'status'}>{message.text}</p>}
		{history && <MarketHistoryContent history={history} selection={selection} />}
	</section>;
}
