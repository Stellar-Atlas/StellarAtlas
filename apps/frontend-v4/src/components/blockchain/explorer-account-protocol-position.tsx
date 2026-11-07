'use client';

import { useEffect, useRef } from 'react';
import { buildEntityHref } from '../../api/explorer-analytics';
import { fetchAccountProtocolPosition, type AccountProtocolPosition } from '../../api/explorer-account-protocol-position';
import { protocolPositionPool } from '../../domain/account-protocol-position';
import { LocalDateTime } from '../local-date-time';
import { formatAtomic } from './explorer-format-values';
import { ExplorerLink as Link } from './explorer-investigation';
import { withExplorerRequestDeadline } from './explorer-request';
import { useExplorerRequest } from './use-explorer-request';
import styles from './explorer-entity.module.css';

export function ExplorerAccountProtocolPosition({ account }: { readonly account: string }): React.JSX.Element {
	const { result, error, loading, run } = useExplorerRequest<{ value: AccountProtocolPosition } | null>(null, 'Could not load the protocol observation.');
	const pending = useRef<AbortController | null>(null);
	useEffect(() => () => { pending.current?.abort(); }, []);
	const load = () => {
		if (pending.current) return;
		const controller = new AbortController();
		pending.current = controller;
		void run(async () => ({
			// Nest the typed result: an unavailable observation is a valid scoped
			// response, not the generic transport-error sentinel used by the hook.
			value: await withExplorerRequestDeadline(controller, 70_000, () => fetchAccountProtocolPosition(account, controller.signal))
		})).finally(() => {
			if (pending.current === controller) pending.current = null;
		});
	};
	return <section className={styles.panel} aria-label="Protocol positions" aria-busy={loading}>
		<h2>Protocol positions</h2>
		<p><Link href={buildEntityHref('contracts', protocolPositionPool)}>Blend Fixed v2.1</Link> · XLM supply only</p>
		<p className={styles.muted}>One pool and asset only. These observations are separate from wallet balances and reserves.</p>
		<div className={styles.actions}>
			<button type="button" disabled={loading} onClick={load}>{result || error ? 'Check saved observation again' : 'Load saved observation'}</button>
		</div>
		{loading && <p role="status">Loading saved observation…</p>}
		{error && <p role="alert">{error}</p>}
		{!loading && !error && result && <ProtocolPositionEvidence result={result.value} />}
	</section>;
}

export function ProtocolPositionEvidence({ result }: { readonly result: AccountProtocolPosition }): React.JSX.Element {
	if (result.status === 'unavailable') return <p role="status">Saved protocol evidence is unavailable.</p>;
	const { asOf } = result;
	return <>
		<p className={styles.muted}>
			{asOf.freshness === 'historical' ? 'Historical observation' : 'Recent observation'} · Ledger{' '}
			<Link href={buildEntityHref('ledgers', String(asOf.ledger))}>{formatAtomic(String(asOf.ledger), 0)}</Link>
			{' · '}<LocalDateTime dateTime={asOf.closedAt} />
		</p>
		{result.status === 'unobserved' ? <p>No XLM supply value observed. This does not establish a zero balance.</p> : <>
			<dl className={styles.details}>
				<dt>Supply shares observed</dt><dd>{formatAtomic(result.sharesRaw, 7)}</dd>
				<dt>Estimated underlying</dt><dd>{formatAtomic(result.estimateRaw, 7)} XLM</dd>
				<dt>Stored rate last updated</dt><dd><LocalDateTime dateTime={result.rateUpdatedAt} /></dd>
			</dl>
			<p className={styles.muted}>Stored-rate estimate. Withdrawal amount not assessed.</p>
		</>}
	</>;
}
