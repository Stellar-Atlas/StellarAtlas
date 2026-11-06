'use client';

import type { PublicRecentTransactions } from '@api/types';
import { useId, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { validLedgerSequence } from '../../api/explorer-ledger-transactions';
import { ExplorerTransactionTable } from './explorer-transaction-table';
import {
	readTransactionMatch, transactionMatchQuery, transactionPageResultQuery, TRANSACTION_MATCH_LIMIT,
	type TransactionPageResult
} from './transaction-page-result';
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
	const match = readTransactionMatch(useSearchParams());
	const matching = match ? loaded.filter(row => row.hash.toLowerCase().includes(match) ||
		row.sourceAccount.toLowerCase().includes(match)) : loaded;
	const successful = matching.filter(row => row.successful).length;
	const counts = { all: matching.length, successful, failed: matching.length - successful };
	const records = result === 'all' ? matching : matching.filter(row => row.successful === (result === 'successful'));
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
			<TransactionMatchForm match={match} />
			<div className={styles.resultFilters} role="group" aria-label={match ? 'Result among matching rows' : 'Result on this page'}>
				<span>{match ? 'Result among matching rows' : 'Result on this page'}</span>
				{(['all', 'successful', 'failed'] as const).map(value => (
					<button key={value} type="button" aria-pressed={value === result} onClick={() => navigate(value)}>
						{resultLabels[value]} {counts[value]}
					</button>
				))}
			</div>
			{match && records.length > 0 && <p className={styles.matchStatus} role="status">
				{records.length} of {loaded.length} loaded transactions shown.
			</p>}
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
				: <p className="explorer-state neutral" role="status">{match
					? 'No ' + (result === 'all' ? '' : result + ' ') + 'transactions on this page match that identifier.'
					: 'No ' + (result === 'all' ? '' : result + ' ') + 'transactions on this page.'}</p>}
		</div>
	);
}

function TransactionMatchForm({ match }: { readonly match: string }): React.JSX.Element {
	const id = useId();
	const input = useRef<HTMLInputElement>(null);
	const [draft, setDraft] = useState({ applied: match, value: match, invalid: false });
	if (draft.applied !== match) setDraft({ applied: match, value: match, invalid: false });

	const apply = (value: string) => {
		const { pathname, search, hash } = window.location;
		const query = transactionMatchQuery(search, value);
		if (query === null) { setDraft({ ...draft, invalid: true }); return; }
		setDraft({ ...draft, value: value.trim().toLowerCase(), invalid: false });
		if (search !== query) window.history.pushState(null, '', pathname + query + hash);
	};
	return <form className={styles.transactionMatch} onSubmit={event => {
		event.preventDefault();
		apply(draft.value);
	}}>
		<label htmlFor={id}>Find on this page</label>
		<input ref={input} id={id} value={draft.value} placeholder="Hash or source account"
			maxLength={TRANSACTION_MATCH_LIMIT} autoComplete="off" spellCheck={false}
			aria-invalid={draft.invalid || undefined} aria-describedby={draft.invalid ? id + '-error' : undefined}
			onChange={event => setDraft({ ...draft, value: event.currentTarget.value, invalid: false })} />
		<button type="submit">Filter</button>
		{(match || draft.value) && <button type="button" onClick={() => { apply(''); input.current?.focus(); }}>Clear</button>}
		{draft.invalid && <p id={id + '-error'} role="alert">Use letters and numbers from a hash or source account.</p>}
	</form>;
}
