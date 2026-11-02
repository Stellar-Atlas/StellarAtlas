'use client';

import { useState } from 'react';
import { ExplorerLink as Link } from './explorer-investigation';
import { entityText, normalizeWarehouseTimestamp, buildEntityHref, type EntityRecord } from '../../api/explorer-analytics';
import { decodeContractEventValue } from '../../domain/contract-event-value';
import { LocalDateTime } from '../local-date-time';
import { formatAtomic } from './explorer-format-values';
import { ExplorerDetailDialog } from './explorer-detail-dialog';
import { ContractValuePreview } from './explorer-contract-value-preview';
import { StateKey, StateValue } from './explorer-contract-state-values';
import styles from './explorer-contract-state-change-table.module.css';

function identity(row: EntityRecord) {
	return {
		ledger: entityText(row, 'ledger_sequence') || entityText(row, '_ledger_sequence'),
		transaction: entityText(row, 'transaction_hash'),
		timestamp: entityText(row, 'closed_at')
	};
}

export function ExplorerContractStateDetails({
	row, onClose
}: { readonly row: EntityRecord; readonly onClose: () => void }): React.JSX.Element {
	const { ledger, transaction, timestamp } = identity(row);
	const key = decodeContractEventValue(row.key_decoded ?? row.key);
	const value = decodeContractEventValue(row.val_decoded ?? row.val ?? row.value);
	return (
		<ExplorerDetailDialog title="State change" onClose={onClose}>
			<dl className={styles.identity}>
				{ledger && <div><dt>Ledger</dt><dd><Link href={buildEntityHref('ledgers', ledger)}>{formatAtomic(ledger, 0)}</Link></dd></div>}
				{timestamp && <div><dt>Time</dt><dd><LocalDateTime dateTime={normalizeWarehouseTimestamp(timestamp)} /></dd></div>}
				{transaction && <div><dt>Transaction</dt><dd><Link className={styles.reference} href={buildEntityHref('transactions', transaction, ledger ? { ledger_sequence: ledger } : {})}><code>{transaction}</code></Link></dd></div>}
			</dl>
			<h4>Key</h4>
			<StateKey value={key} ledger={ledger} />
			<h4>Recorded value</h4>
			<StateValue value={value} ledger={ledger} />
			<details className={styles.raw}>
				<summary>Original record</summary>
				<pre>{JSON.stringify(row, null, 2)}</pre>
			</details>
		</ExplorerDetailDialog>
	);
}

export function ExplorerContractStateChangeTable({
	rows
}: { readonly rows: readonly EntityRecord[] }): React.JSX.Element {
	const [selected, setSelected] = useState<EntityRecord | null>(null);
	const hasTransactions = rows.some(row => entityText(row, 'transaction_hash') !== '');
	return (
		<>
			<div className={styles.scroll}>
				<table className={styles.table} data-transactions={hasTransactions} aria-label="Contract state changes">
					<colgroup><col className={styles.ledgerColumn} /><col className={styles.keyColumn} /><col className={styles.valueColumn} />{hasTransactions && <col className={styles.transactionColumn} />}<col className={styles.actionColumn} /></colgroup>
					<thead><tr><th scope="col">Ledger / time</th><th scope="col">Key</th><th scope="col">Value</th>{hasTransactions && <th scope="col">Transaction</th>}<th scope="col"><span className={styles.srOnly}>Details</span></th></tr></thead>
					<tbody>
						{rows.map((row, index) => {
							const { ledger, transaction, timestamp } = identity(row);
							// Preview decoding stays bounded; only an explicitly opened record
							// mounts the full nested values and original-record serialization.
							const key = decodeContractEventValue(row.key_decoded ?? row.key, { maxNodes: 128, maxDepth: 16 });
							const value = decodeContractEventValue(row.val_decoded ?? row.val ?? row.value, { maxNodes: 128, maxDepth: 16 });
							return (
								<tr key={entityText(row, 'id') || `${ledger}:${index}`}>
									<td><strong>{ledger ? <Link className={styles.reference} href={buildEntityHref('ledgers', ledger)}>{formatAtomic(ledger, 0)}</Link> : 'Not reported'}</strong>{timestamp && <LocalDateTime dateTime={normalizeWarehouseTimestamp(timestamp)} />}</td>
									<td><ContractValuePreview value={key} ledger={ledger} kind="key" /></td>
									<td><ContractValuePreview value={value} ledger={ledger} /></td>
									{hasTransactions && <td>{transaction ? <Link className={styles.reference} href={buildEntityHref('transactions', transaction, ledger ? { ledger_sequence: ledger } : {})}><code className={styles.transaction}>{transaction}</code></Link> : <span className={styles.muted}>Not recorded</span>}</td>}
									<td><button className={styles.detailsButton} type="button" aria-haspopup="dialog" aria-label={`State change details${ledger ? ' at ledger ' + ledger : ''}, row ${index + 1}`} onClick={() => setSelected(row)}>Details</button></td>
								</tr>
							);
						})}
						{rows.length === 0 && <tr><td colSpan={hasTransactions ? 5 : 4} className={styles.empty}>No state changes in this result.</td></tr>}
					</tbody>
				</table>
			</div>
			{selected && <ExplorerContractStateDetails row={selected} onClose={() => setSelected(null)} />}
		</>
	);
}
