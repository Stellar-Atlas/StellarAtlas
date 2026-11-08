'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { buildEntityHref } from '../../api/explorer-analytics';
import { fetchClaimablePage, type ClaimablePage, type ClaimablePageFailure, type ClaimablePosition, type ClaimPredicate } from '../../api/explorer-claimable-positions';
import type { ClaimableRole } from '../../domain/claimable-positions';
import { LocalDateTime } from '../local-date-time';
import { AccountAssetIdentity } from './explorer-account-asset-identity';
import { formatAtomic } from './explorer-format-values';
import { ExplorerLink as Link } from './explorer-investigation';
import { withExplorerRequestDeadline } from './explorer-request';
import { useExplorerRequest } from './use-explorer-request';
import styles from './explorer-entity.module.css';
import positions from './explorer-claimable-positions.module.css';

const labels = { claimant: 'Named as claimant', sponsor: 'Sponsoring reserve' } as const;
type PageRequest = { readonly role: ClaimableRole; readonly cursor: string | null };
type PageResult = PageRequest & { readonly page: ClaimablePage | ClaimablePageFailure };

export function ExplorerClaimablePositions({ account }: { readonly account: string }): React.JSX.Element {
	const [open, setOpen] = useState(false);
	const panelId = useId();
	return <section className={styles.panel} aria-label="Claimable positions">
		<h2>Claimable positions</h2>
		<div className={styles.actions}>
			<button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
				{open ? 'Close positions' : 'View claimable positions'}
			</button>
		</div>
		<div id={panelId} className={positions.content} hidden={!open}>{open && <PositionsPanel account={account} />}</div>
	</section>;
}

function PositionsPanel({ account }: { readonly account: string }): React.JSX.Element {
	const [selection, select] = useState<PageRequest | null>(null);
	const { result, error, loading, run } = useExplorerRequest<PageResult | null>(null, 'Claimable positions could not be loaded.');
	const pending = useRef<AbortController | null>(null);
	useEffect(() => () => { pending.current?.abort(); }, []);
	const load = (role: ClaimableRole, cursor: string | null) => {
		if (pending.current) return;
		const abort = new AbortController();
		pending.current = abort;
		select({ role, cursor });
		void run(() => withExplorerRequestDeadline(abort, 70_000, async () => ({
			role, cursor, page: await fetchClaimablePage(account, role, cursor, abort.signal)
		}))).finally(() => {
			if (pending.current === abort) pending.current = null;
		});
	};
	const current = result && selection?.role === result.role && selection.cursor === result.cursor ? result.page : null;
	return <>
		<p className={styles.muted}>Separate from wallet balances. Sponsoring reserve does not identify who created the position. Soroban positions are not included.</p>
		<p className={styles.muted}>Loading a page sends this account address through Atlas to its configured Horizon provider, which may be an operator-selected external provider.</p>
		<div className={styles.actions} role="group" aria-label="Position role">
			{(['claimant', 'sponsor'] as const).map(role => <button key={role} type="button"
				aria-pressed={selection?.role === role} aria-disabled={loading || selection?.role === role}
				onClick={() => { if (selection?.role !== role) load(role, null); }}>{labels[role]}</button>)}
		</div>
		{loading && <p role="status">Loading claimable positions…</p>}
		{error && selection && <div className={styles.actions}>
			<p role="alert">{error}</p>
			<button type="button" onClick={() => load(selection.role, selection.cursor)}>Try again</button>
			{selection.cursor && <button type="button" onClick={() => load(selection.role, null)}>First page</button>}
		</div>}
		{!loading && !error && current && 'status' in current && selection && <>
			<ClaimableProviderEvidence value={current} />
			<p role={current.status === 'unsupported' ? 'status' : 'alert'}>{current.status === 'unsupported'
				? 'Claimable positions are not supported by the configured service.' : 'Claimable positions could not be loaded.'}
				{current.retryAfterSeconds !== null && <> Try again after {current.retryAfterSeconds} seconds.</>}</p>
			<div className={styles.actions}>
				<button type="button" onClick={() => load(selection.role, selection.cursor)}>Try again</button>
				{selection.cursor && <button type="button" onClick={() => load(selection.role, null)}>First page</button>}
			</div>
		</>}
		{!loading && !error && current && !('status' in current) && selection && <>
			<ClaimableProviderEvidence value={current} />
			<p className={styles.muted}>
				{current.latestLedger === null ? 'Horizon did not report an as-of ledger.' : <>Horizon ledger <Ledger sequence={current.latestLedger} />.</>}
				{' '}Freshness is not confirmed. Pages may reflect different ledgers.
			</p>
			{current.partial && <p role="status">This page contains partial provider evidence.</p>}
			{current.positions.length === 0 ? <p>No positions returned on this page.</p> : <ul className={positions.list}>
				{current.positions.map(position => <li key={position.id}><Position position={position} /></li>)}
			</ul>}
			{(selection.cursor || current.nextCursor && current.nextCursor !== selection.cursor) && <div className={styles.actions}>
				{selection.cursor && <button type="button" onClick={() => load(selection.role, null)}>First page</button>}
				{current.nextCursor && current.nextCursor !== selection.cursor && <button type="button"
					onClick={() => load(selection.role, current.nextCursor)}>Next page</button>}
			</div>}
		</>}
	</>;
}

/** Present on successful pages and attributed provider errors. Never links to an external provider. */
export function ClaimableProviderEvidence({ value }: { readonly value: ClaimablePage | ClaimablePageFailure }): React.JSX.Element {
	return <div className={styles.muted}>
		<p>{value.provider ? <>Provider: {value.provider.hostname} (operator-selected alternate). Atlas sent this account address to this provider.</>
			: value.transmission === 'native' ? 'Provider: Atlas native Horizon.' : 'The provider for this response could not be confirmed.'}</p>
		{!('status' in value) && <p>Response observed <LocalDateTime dateTime={value.observation.observedAt} />. This is the response observation time.
			{' '}The provider network and chain freshness are not independently confirmed for this page.</p>}
	</div>;
}

function Ledger({ sequence }: { readonly sequence: string }): React.JSX.Element {
	return <Link href={buildEntityHref('ledgers', sequence)}>{formatAtomic(sequence, 0)}</Link>;
}

function Position({ position }: { readonly position: ClaimablePosition }): React.JSX.Element {
	return <article className={positions.position}>
		<div className={positions.summary}>
			{position.asset === 'native' ? <Link href={buildEntityHref('assets', 'native')}>XLM</Link>
				: <AccountAssetIdentity asset={position.asset} />}
			<strong>{formatAtomic(position.amountRaw, 7)}</strong>
		</div>
		<p className={styles.muted}>{position.roles.map(role => labels[role]).join(' · ')}</p>
		<details className={positions.details}>
			<summary>Claim conditions and ledger evidence</summary>
			<p>Conditions are not evaluated.</p>
			<ul className={positions.claimants}>
				{position.claimants.map(({ destination, predicate }) => <li key={destination}>
					<Link href={buildEntityHref('accounts', destination)}>{destination}</Link>
					<div><Condition value={predicate} /></div>
				</li>)}
			</ul>
			<p>Reserve sponsor: {position.sponsor
				? <Link href={buildEntityHref('accounts', position.sponsor)}>{position.sponsor}</Link> : 'Not reported'}</p>
			<p>Last changed in ledger <Ledger sequence={position.lastModifiedLedger} />
				{position.lastModifiedAt && <> · <LocalDateTime dateTime={position.lastModifiedAt} /></>}</p>
			<p>Position ID: <code>{position.id}</code></p>
		</details>
	</article>;
}

function Condition({ value }: { readonly value: ClaimPredicate }): React.JSX.Element {
	switch (value.type) {
		case 'unconditional': return <>No time condition</>;
		case 'not': return <>Not (<Condition value={value.predicate} />)</>;
		case 'and':
		case 'or': return <>(<Condition value={value.predicates[0]} /> {value.type === 'and' ? 'and' : 'or'} <Condition value={value.predicates[1]} />)</>;
		case 'before_absolute_time': return <>Before {value.isoTime
			? <LocalDateTime dateTime={value.isoTime} />
			: <>Unix time {formatAtomic(value.epochSeconds, 0)} seconds</>}</>;
		case 'before_relative_time': return <>Before {formatAtomic(value.seconds, 0)} seconds after creation</>;
	}
}
