import Link from 'next/link';
import { Fragment } from 'react';
import {
	buildEntityHref,
	entityText,
	normalizeWarehouseTimestamp,
	type EntityRecord
} from '../../api/explorer-analytics';
import type { ContractActivityTab } from '../../api/explorer-contract-activity';
import { LocalDateTime } from '../local-date-time';
import { ExplorerEventProvenance } from './explorer-event-provenance';
import { formatContractJson } from './explorer-contract-activity-model';
import styles from './explorer-entity.module.css';

export function ExplorerContractRecord({
	row,
	tab
}: {
	readonly row: EntityRecord;
	readonly tab: ContractActivityTab;
}): React.JSX.Element {
	const ledger =
		entityText(row, tab === 'events' ? 'ledgerSequence' : 'ledger_sequence') ||
		entityText(row, '_ledger_sequence');
	const timestamp = entityText(
		row,
		tab === 'events' ? 'closedAt' : 'closed_at'
	);
	const transaction = entityText(
		row,
		tab === 'events' ? 'transactionHash' : 'transaction_hash'
	);
	const values: readonly (readonly [string, unknown])[] =
		tab === 'events'
			? [
					['Decoded topics', row.topicsJson],
					['Decoded payload', row.dataJson]
				]
			: [
					['Recorded key', row.key_decoded ?? row.key],
					['Recorded value', row.val_decoded ?? row.val ?? row.value]
				];
	return (
		<article className={styles.panel}>
			<div className={styles.status}>
				<span>Ledger {ledger || 'not reported'}</span>
				{timestamp && (
					<LocalDateTime dateTime={normalizeWarehouseTimestamp(timestamp)} />
				)}
				{tab === 'events' && (
					<>
						<span>
							Event type: {entityText(row, 'type') || 'not classified'}
						</span>
						<span>
							{row.successful === true
								? 'Transaction successful'
								: 'Transaction failed'}
						</span>
						<span>
							{row.inSuccessfulContractCall === true
								? 'In successful contract call'
								: 'Not in a successful contract call'}
						</span>
					</>
				)}
			</div>
			{tab === 'events' && <ExplorerEventProvenance row={row} />}
			{transaction && (
				<Link
					href={buildEntityHref(
						'transactions',
						transaction,
						ledger ? { ledger_sequence: ledger } : {}
					)}
				>
					Open transaction
				</Link>
			)}
			<dl className={styles.details}>
				{values.map(([label, value]) => (
					<Fragment key={label}>
						<dt>{label}</dt>
						<dd>
							<pre className={styles.json}>{formatContractJson(value)}</pre>
						</dd>
					</Fragment>
				))}
			</dl>
			<details>
				<summary>
					{tab === 'events'
						? 'Typed event record and original XDR'
						: 'Original state-change record'}
				</summary>
				<pre className={styles.json}>{JSON.stringify(row, null, 2)}</pre>
			</details>
		</article>
	);
}
