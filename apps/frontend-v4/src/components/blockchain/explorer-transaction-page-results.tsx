'use client';

import type { PublicRecentTransactions } from '@api/types';
import { useId, useState } from 'react';
import { validLedgerSequence } from '../../api/explorer-ledger-transactions';
import { ExplorerTransactionTable } from './explorer-transaction-table';
import { transactionPageResultQuery, type TransactionPageResult } from './transaction-page-result';
import styles from './explorer-transaction-table.module.css';

const resultLabels = { all: 'All', successful: 'Successful', failed: 'Failed' } as const;

/** Filters only the already loaded, bounded page. Does not affect paging or issue a query. */
export function ExplorerTransactionPageResults({ transactions, result, caption, returnTo }: {
	readonly transactions: Pick<PublicRecentTransactions, 'records' | 'limit'>;
	readonly result: TransactionPageResult;
	readonly caption: string;
	readonly returnTo?: string;
}): React.JSX.Element {
	const loaded = transactions.records.slice(0, transactions.limit);
	const successful = loaded.filter(row => row.successful).length;
	const counts = { all: loaded.length, successful, failed: loaded.length - successful };
	const records = result === 'all' ? loaded : loaded.filter(row => row.successful === (result === 'successful'));
	const ledgers = new Map<string, { firstHash: string; count: number }>();
	for (const row of records) {
		if (!validLedgerSequence(row.ledger)) continue;
		const group = ledgers.get(row.ledger);
		if (group) group.count++;
		else ledgers.set(row.ledger, { firstHash: row.hash, count: 1 });
	}
	const jumpPrefix = useId();
	const [requestedLedger, setRequestedLedger] = useState('');
	const activeLedger = ledgers.has(requestedLedger) ? requestedLedger : ledgers.keys().next().value ?? '';
	const showJump = ledgers.size > 1;
	const navigate = (next: TransactionPageResult) => {
		const { pathname, search, hash } = window.location;
		const query = transactionPageResultQuery(search, next);
		if (search !== query) window.history.pushState(null, '', pathname + query + hash);
	};
	return (
		<div className={styles.pageResults}>
			<div className={styles.resultFilters} role="group" aria-label="Result on this page">
				<span>Result on this page</span>
				{(['all', 'successful', 'failed'] as const).map(value => (
					<button key={value} type="button" aria-pressed={value === result} onClick={() => navigate(value)}>
						{resultLabels[value]} {counts[value]}
					</button>
				))}
			</div>
			{showJump && <form className={styles.ledgerJump} onSubmit={event => {
				event.preventDefault();
				const group = ledgers.get(activeLedger);
				if (group) document.getElementById(jumpPrefix + '-' + group.firstHash)?.focus();
			}}>
				<label htmlFor={jumpPrefix + '-ledger'}>Jump to ledger on this page</label>
				<select id={jumpPrefix + '-ledger'} value={activeLedger}
					onChange={event => setRequestedLedger(event.currentTarget.value)}>
					{[...ledgers].map(([ledger, { count }]) => (
						<option key={ledger} value={ledger}>
							{Number(ledger).toLocaleString('en-US')} · {count} {count === 1 ? 'transaction' : 'transactions'}
						</option>
					))}
				</select>
				<button type="submit">Jump</button>
			</form>}
			{records.length > 0
				? <ExplorerTransactionTable transactions={{ records, limit: transactions.limit }} caption={caption} returnTo={returnTo}
					jumpPrefix={showJump ? jumpPrefix : undefined} />
				: <p className="explorer-state neutral" role="status">No {result === 'all' ? '' : result + ' '}transactions on this page.</p>}
		</div>
	);
}
