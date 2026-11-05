'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { buildEntityHref } from '../../api/explorer-analytics';
import { fetchCurrentAccount, type CurrentAccount, type CurrentBalance } from '../../api/explorer-current-account';
import { LocalDateTime } from '../local-date-time';
import { AccountAssetIdentity } from './explorer-account-asset-identity';
import { ExplorerBalanceObservations } from './explorer-balance-observations';
import { ExplorerLink as Link } from './explorer-investigation';
import { formatAtomic } from './explorer-format-values';
import { withExplorerRequestDeadline } from './explorer-request';
import { useExplorerRequest } from './use-explorer-request';
import { readWalletCursor } from './wallet-balance-route';
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
		void request.run(() => withExplorerRequestDeadline(abort, 15_000, async () => ({
			value: await fetchCurrentAccount(account, abort.signal), fetchedAt: new Date().toISOString()
		}))).finally(() => {
			if (inFlight.current === abort) inFlight.current = null;
		});
	}, [account, request.run]);
	useEffect(() => {
		load();
		return () => {
			inFlight.current?.abort();
			inFlight.current = null;
		};
	}, [load]);
	return <section className={styles.panel} aria-label="Current account balances" aria-busy={request.loading}>
		<h2>Current account balances</h2>
		<p className={assets.context}>Latest from the configured Stellar Horizon service · Classic account only</p>
		<div className={styles.actions}>
			<button type="button" disabled={request.loading} onClick={load}>Refresh current account</button>
		</div>
		{request.loading && <p role="status">Loading current account…</p>}
		{request.error && <p role="alert">{request.error}{request.result ? ' Showing the last successful response.' : ''}</p>}
		{request.result && <p className={assets.context}>Fetched <LocalDateTime dateTime={request.result.fetchedAt} /></p>}
		{request.result?.value === null && <p>Account not found by Horizon.</p>}
		{request.result?.value && <CurrentAccountInventory value={request.result.value} />}
	</section>;
}

export function CurrentAccountInventory({ value }: { readonly value: CurrentAccount }): React.JSX.Element {
	const [view, setView] = useState<View>('assets'), [page, setPage] = useState(0);
	const rows = value.balances.filter(row => view === 'trustlines' ? row.kind !== 'native' : row.kind === 'native' || row.balance > 0n);
	const offset = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1)) * pageSize;
	const visible = rows.slice(offset, offset + pageSize);
	return <>
		{value.lastModifiedLedger !== null && <p className={assets.context}>Account entry last changed in ledger{' '}
			<Link href={buildEntityHref('ledgers', String(value.lastModifiedLedger))}>{formatAtomic(String(value.lastModifiedLedger), 0)}</Link>.
		</p>}
		<div className={styles.actions} role="group" aria-label="Current account view">
			{(['assets', 'trustlines'] as const).map(mode => <button key={mode} type="button" aria-pressed={mode === view}
				onClick={() => { setView(mode); setPage(0); }}>{mode === 'assets' ? 'Assets' : 'Trustlines'}</button>)}
		</div>
		{!rows.length ? <p>{view === 'trustlines' ? 'No trustlines reported by Horizon.' : 'No asset balances reported by Horizon.'}</p>
			: <div className={styles.tableWrap}><table className={styles.table} aria-label={view === 'trustlines' ? 'Current trustlines' : 'Current assets'}>
				<thead><tr><th scope="col">Asset</th><th scope="col">Total balance</th>
					{view === 'trustlines' && <><th scope="col">Limit</th><th scope="col">Authorization &amp; sponsor</th></>}
				</tr></thead>
				<tbody>{visible.map(row => <tr key={row.id}>
					<td data-label="Asset"><CurrentAsset row={row} /></td>
					<td data-label="Total balance" className={assets.amount}>{formatAtomic(row.balance.toString(), 7)}</td>
					{view === 'trustlines' && <>
						<td data-label="Limit" className={assets.amount}>{row.limit === null ? 'Not reported' : formatAtomic(row.limit.toString(), 7)}</td>
						<td data-label="Authorization & sponsor">{row.kind === 'credit' ? authorization[row.authorization] : 'Pool-share trustline'}
							{row.sponsor && <div className={assets.context}>Sponsor: <Link href={buildEntityHref('accounts', row.sponsor)}>{row.sponsor}</Link></div>}
						</td>
					</>}
				</tr>)}</tbody>
			</table></div>}
		{rows.length > pageSize && <div className={styles.actions} role="group" aria-label="Current account pages">
			<button type="button" disabled={offset === 0} onClick={() => setPage(offset / pageSize - 1)}>Previous</button>
			<button type="button" disabled={offset + pageSize >= rows.length} onClick={() => setPage(offset / pageSize + 1)}>Next</button>
			<span>{offset + 1}–{offset + visible.length} of {rows.length}</span>
		</div>}
	</>;
}

function CurrentAsset({ row }: { readonly row: CurrentBalance }): React.JSX.Element {
	if (row.kind === 'credit') return <AccountAssetIdentity asset={row} />;
	return row.kind === 'native'
		? <div className={assets.identity}><span className={assets.mark} aria-hidden="true">X</span><Link href={buildEntityHref('assets', 'native')}>XLM</Link></div>
		: <div className={assets.identity}><Link href={buildEntityHref('liquidity-pools', row.id)}>Liquidity pool shares</Link></div>;
}
