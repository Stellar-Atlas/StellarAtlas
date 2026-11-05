'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { buildEntityHref, type EntityRecord } from '../../api/explorer-analytics';
import { fetchCurrentAccount, type CurrentAccount, type CurrentBalance } from '../../api/explorer-current-account';
import { currentAccountFreshness, type CurrentAccountSnapshot } from '../../api/explorer-current-account-snapshot';
import { LocalDateTime } from '../local-date-time';
import { AccountAssetIdentity } from './explorer-account-asset-identity';
import { currentAccountBreakdown } from './explorer-current-account-breakdown';
import { ExplorerBalanceObservations } from './explorer-balance-observations';
import { ExplorerLink as Link } from './explorer-investigation';
import { formatAtomic } from './explorer-format-values';
import { withExplorerRequestDeadline } from './explorer-request';
import { useExplorerRequest } from './use-explorer-request';
import { readWalletCursor } from './wallet-balance-route';
import { useWalletAssetMetadata } from './explorer-wallet-metadata';
import styles from './explorer-entity.module.css';
import assets from './explorer-account-assets.module.css';

type Source = 'current' | 'indexed';
type View = 'assets' | 'trustlines';
const pageSize = 25;
const failure = 'Could not load the current account from Horizon.';
const authorization = {
	authorized: 'Authorized', 'liabilities-only': 'Maintain liabilities only',
	restricted: 'Not authorized', unknown: 'Not reported'
};

export function ExplorerAccountAssets({ account }: { readonly account: string }): React.JSX.Element {
	const params = useSearchParams(), path = usePathname();
	const sourceParam = params.get('wallet_source');
	const source: Source = sourceParam === 'indexed' ||
		(sourceParam !== 'current' && readWalletCursor(params, account) !== null) ? 'indexed' : 'current';
	const select = (next: Source) => {
		if (next === source) return;
		const query = new URLSearchParams(window.location.search);
		query.set('wallet_source', next);
		window.history.pushState(null, '', path + '?' + query.toString() + window.location.hash);
	};
	return <>
		<div className={styles.actions} role="group" aria-label="Account balance source">
			<button type="button" aria-pressed={source === 'current'} onClick={() => select('current')}>Current account</button>
			<button type="button" aria-pressed={source === 'indexed'} onClick={() => select('indexed')}>Indexed observations</button>
		</div>
		{source === 'current' ? <CurrentAccountPanel key={account} account={account} />
			: <ExplorerBalanceObservations key={account} identifier={account} kind="balances" autoLoad />}
	</>;
}

function CurrentAccountPanel({ account }: { readonly account: string }): React.JSX.Element {
	const request = useExplorerRequest<{ value: CurrentAccount | null; fetchedAt: string } | null>(null, failure);
	const inFlight = useRef<AbortController | null>(null);
	const load = useCallback(() => {
		if (inFlight.current !== null) return;
		const abort = new AbortController();
		inFlight.current = abort;
		void request.run(() => withExplorerRequestDeadline(abort, 70_000, async () => ({
			value: await fetchCurrentAccount(account, abort.signal), fetchedAt: new Date().toISOString()
		}))).finally(() => {
			if (inFlight.current === abort) inFlight.current = null;
		});
	}, [account, request.run]);
	useEffect(() => {
		let disposed = false;
		// Let a discarded Strict Mode mount exit before launching its request.
		queueMicrotask(() => { if (!disposed) load(); });
		return () => {
			disposed = true;
			inFlight.current?.abort();
			inFlight.current = null;
		};
	}, [load]);
	return <section className={styles.panel} aria-label="Horizon account balances" aria-busy={request.loading}>
		<h2>Horizon account balances</h2>
		<p className={assets.context}>Configured Stellar Horizon service · Classic account only</p>
		<div className={styles.actions}>
			<button type="button" disabled={request.loading} onClick={load}>Refresh current account</button>
		</div>
		{request.loading && <p role="status">Loading current account…</p>}
		{request.error && <p role="alert">{request.error}{request.result ? ' Showing the last successful response.' : ''}</p>}
		{request.result && <p className={assets.context}>Fetched <LocalDateTime dateTime={request.result.fetchedAt} /></p>}
		{request.result?.value === null && <p>Account not found by Horizon.</p>}
		{request.result?.value && <>
			<AccountSnapshotEvidence snapshot={request.result.value.snapshot} fetchedAt={request.result.fetchedAt} />
			<CurrentAccountInventory value={request.result.value} />
		</>}
	</section>;
}

export function AccountSnapshotEvidence({ snapshot, fetchedAt }: {
	readonly snapshot: CurrentAccountSnapshot; readonly fetchedAt: string;
}): React.JSX.Element {
	const freshness = currentAccountFreshness(snapshot.closedAt, Date.parse(fetchedAt));
	return <div className={assets.context}>
		{snapshot.latestLedger === null ? <p>Horizon did not report an as-of ledger.</p> : <p>
			As of ledger <Link href={buildEntityHref('ledgers', snapshot.latestLedger)}>{formatAtomic(snapshot.latestLedger, 0)}</Link>
			{snapshot.closedAt && <> · <LocalDateTime dateTime={snapshot.closedAt} /></>}
		</p>}
		{freshness === 'stale' && <p className="explorer-state warning" role="status">Horizon snapshot was over 5 minutes old when fetched. These balances are not current.</p>}
		{freshness === 'unknown' && <p>Snapshot freshness is not known.</p>}
		{!snapshot.inventoryComplete && <p>Only the exact rows Horizon reported are shown. Inventory completeness is not established.</p>}
	</div>;
}

export function CurrentAccountInventory({ value }: { readonly value: CurrentAccount }): React.JSX.Element {
	const [view, setView] = useState<View>('assets'), [page, setPage] = useState(0);
	const rows = value.balances.filter(row => view === 'trustlines' ? row.kind !== 'native' : row.kind === 'native' || row.balance > 0n);
	const offset = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1)) * pageSize;
	const visible = rows.slice(offset, offset + pageSize);
	const metadata = useWalletAssetMetadata(visible.filter(row => row.kind === 'credit').map(row => row.id));
	return <>
		{value.lastModifiedLedger !== null && <p className={assets.context}>Account entry last changed in ledger{' '}
			<Link href={buildEntityHref('ledgers', String(value.lastModifiedLedger))}>{formatAtomic(String(value.lastModifiedLedger), 0)}</Link>.
		</p>}
		<div className={styles.actions} role="group" aria-label="Current account view">
			{(['assets', 'trustlines'] as const).map(mode => <button key={mode} type="button" aria-pressed={mode === view}
				onClick={() => { setView(mode); setPage(0); }}>{mode === 'assets' ? 'Assets' : 'Trustlines'}</button>)}
		</div>
		{!rows.length ? <p>{!value.snapshot.inventoryComplete ? 'No exact rows to display in this view.'
			: view === 'trustlines' ? 'No trustlines reported by Horizon.' : 'No asset balances reported by Horizon.'}</p>
			: <div className={styles.tableWrap}><table className={styles.table} aria-label={view === 'trustlines' ? 'Current trustlines' : 'Current assets'}>
				<thead><tr><th scope="col">Asset</th><th scope="col">Total balance</th>
					{view === 'trustlines' ? <><th scope="col">Limit &amp; receive headroom</th><th scope="col">Authorization &amp; sponsor</th></>
						: <><th scope="col">Available</th><th scope="col">Commitments</th></>}
				</tr></thead>
				<tbody>{visible.map(row => {
					const breakdown = currentAccountBreakdown(row, value.snapshot);
					return <tr key={row.id}>
					<td data-label="Asset">
						<CurrentAsset row={row} metadata={metadata[row.id]} />
						{row.kind === 'credit' && <div className={assets.context}>Issuer clawback: {row.clawbackEnabled === true
							? 'Enabled' : row.clawbackEnabled === false ? 'Not enabled' : 'Not reported'}</div>}
					</td>
					<td data-label="Total balance" className={assets.amount}>{formatAtomic(row.balance.toString(), 7)}</td>
					{view === 'trustlines' ? <>
						<td data-label="Limit & receive headroom" className={assets.amount}>
							{row.limit === null ? 'Limit not reported' : formatAtomic(row.limit.toString(), 7)}
							{row.kind === 'credit' && <>
								{row.buying !== null && <div className={assets.context}>Buy offers: {formatAtomic(row.buying.toString(), 7)}</div>}
								{breakdown.receiveHeadroom !== null && <div className={assets.context}>Receive headroom: {formatAtomic(breakdown.receiveHeadroom.toString(), 7)}</div>}
							</>}
						</td>
						<td data-label="Authorization & sponsor">{row.kind === 'credit' ? authorization[row.authorization] : 'Pool-share trustline'}
							{row.sponsor && <div className={assets.context}>Sponsor: <Link href={buildEntityHref('accounts', row.sponsor)}>{row.sponsor}</Link></div>}
						</td>
					</> : <>
						<td data-label="Available" className={assets.amount}>{breakdown.available !== null
							? formatAtomic(breakdown.available.toString(), 7)
							: row.kind === 'credit' && (row.authorization === 'restricted' || row.authorization === 'liabilities-only')
								? 'Restricted' : 'Not calculated'}</td>
						<td data-label="Commitments" className={assets.amount}>
							{row.kind === 'native' && <div>{breakdown.minimumReserve === null ? 'Minimum XLM reserve not calculated'
								: <>
									Minimum XLM reserve: {formatAtomic(breakdown.minimumReserve.toString(), 7)}
									<ReserveInputs snapshot={value.snapshot} />
								</>}</div>}
							{breakdown.heldForOffers === null ? (row.kind === 'pool' ? 'Not calculated' : row.selling === null
								? 'Sell offers not reported' : <>Reported sell offers: {formatAtomic(row.selling.toString(), 7)}</>)
								: <>Held for sell offers: {formatAtomic(breakdown.heldForOffers.toString(), 7)}</>}
							{breakdown.reserveShortfall !== null && breakdown.reserveShortfall > 0n &&
								<div className={assets.context}>Reserve shortfall: {formatAtomic(breakdown.reserveShortfall.toString(), 7)}</div>}
							{breakdown.offerShortfall !== null && breakdown.offerShortfall > 0n &&
								<div className={assets.context}>Sell-offer shortfall: {formatAtomic(breakdown.offerShortfall.toString(), 7)}</div>}
						</td>
					</>}
					</tr>;
				})}</tbody>
			</table></div>}
		{view === 'assets' && rows.length > 0 && <p className={assets.context}>
			Available excludes sell offers and, for XLM, the minimum reserve when known. It does not account for transaction fees.
		</p>}
		{rows.length > pageSize && <div className={styles.actions} role="group" aria-label="Current account pages">
			<button type="button" disabled={offset === 0} onClick={() => setPage(offset / pageSize - 1)}>Previous</button>
			<button type="button" disabled={offset + pageSize >= rows.length} onClick={() => setPage(offset / pageSize + 1)}>Next</button>
			<span>{offset + 1}–{offset + visible.length} of {rows.length}</span>
		</div>}
	</>;
}

function ReserveInputs({ snapshot }: { readonly snapshot: CurrentAccountSnapshot }): React.JSX.Element | null {
	const { baseReserve, subentries, sponsoring, sponsored } = snapshot;
	if (baseReserve === null || subentries === null || sponsoring === null || sponsored === null) return null;
	return <details className={assets.context}>
		<summary>Reserve breakdown</summary>
		<div>Base reserve: {formatAtomic(baseReserve.toString(), 7)} XLM per unit</div>
		<div>Account: 2 units · Subentries: {formatAtomic(subentries.toString(), 0)}</div>
		<div>Sponsoring: +{formatAtomic(sponsoring.toString(), 0)} · Sponsored: −{formatAtomic(sponsored.toString(), 0)}</div>
	</details>;
}

function CurrentAsset({ row, metadata }: { readonly row: CurrentBalance; readonly metadata?: EntityRecord }): React.JSX.Element {
	if (row.kind === 'credit') return <AccountAssetIdentity asset={row} metadata={metadata} />;
	return row.kind === 'native'
		? <div className={assets.identity}><span className={assets.mark} aria-hidden="true">X</span><Link href={buildEntityHref('assets', 'native')}>XLM</Link></div>
		: <div className={assets.identity}><Link href={buildEntityHref('liquidity-pools', row.id)}>Liquidity pool shares</Link></div>;
}
