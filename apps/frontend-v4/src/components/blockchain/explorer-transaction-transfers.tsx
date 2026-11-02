'use client';
import type { TransactionTransferScope } from '../../api/transaction-transfers';
import { LocalDateTime } from '../local-date-time';
import { ExplorerTransferTable } from './explorer-transfer-table';
import { useTransactionTransfers } from './use-transaction-transfers';
import styles from './explorer-entity.module.css';

export function ExplorerTransactionTransfers(scope: TransactionTransferScope): React.JSX.Element {
	const state = useTransactionTransfers(scope);
	return <section className={styles.panel} aria-label="Transaction transfers" aria-busy={state.busy}>
		<h3>Transfers</h3>
		<p className={styles.muted}>Indexed token movements, not net balance changes.</p>
		<div className={styles.actions}>
			<button type="button" disabled={state.busy} onClick={state.activated ? state.load : state.first}>{!state.activated ? 'Load transfers' : state.error ? 'Retry transfers' : 'Refresh transfers'}</button>
			{state.busy && <button type="button" onClick={state.cancel}>Cancel transfers</button>}
		</div>
		{state.busy && <p role="status">Loading transfers…</p>}
		{state.error && <p role="alert" className={styles.error}>{state.error}</p>}
		{state.page && <>
			<p className={styles.muted}>Partial indexed history · checked <LocalDateTime dateTime={state.page.watermark.observedAt} /></p>
			{state.page.transfers.length ? <ExplorerTransferTable rows={state.page.transfers} /> : <p>{state.page.watermark.maximumLedger < Number(scope.ledger) ? 'This ledger is beyond the transfer publication watermark.' : 'No indexed transfers returned for this transaction.'}</p>}
		</>}
		{state.activated && <div className={styles.actions}>
			<button type="button" disabled={state.busy || !state.previous} onClick={state.previous ?? undefined}>Previous transfers</button>
			<button type="button" disabled={state.busy || !state.next} onClick={state.next ?? undefined}>Next transfers</button>
			<button type="button" disabled={state.busy} onClick={state.first}>First transfers</button>
		</div>}
	</section>;
}
