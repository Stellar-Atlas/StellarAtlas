'use client';

import { useCallback, useRef, useState } from 'react';
import { validLedgerSequence } from '../../api/explorer-ledger-transactions';
import { LedgerTransactions } from './explorer-ledger-activity';
import { transactionHistoryHref, type TransactionHistorySelection } from './transaction-history-route';
import type { TransactionPageResult } from './transaction-page-result';
import styles from './explorer-transaction-table.module.css';

export function ExplorerTransactionHistory({ selection, search, result }: {
	readonly selection: TransactionHistorySelection;
	readonly search: string;
	readonly result: TransactionPageResult;
}): React.JSX.Element {
	const active = selection.mode === 'ledger' ? selection : null;
	const [ledgerInput, setLedgerInput] = useState(active?.ledger ?? '');
	const [inputError, setInputError] = useState(false);
	const paging = useRef(false);
	const focusPageHeading = useCallback((heading: HTMLHeadingElement | null) => {
		if (heading && paging.current) {
			paging.current = false;
			heading.focus();
		}
	}, []);
	const navigate = (ledger: string | null, offset = 0) => {
		const href = transactionHistoryHref(window.location.search, ledger === null ? null : { ledger, offset }, window.location.hash);
		if (href !== window.location.pathname + window.location.search + window.location.hash)
			window.history.pushState(null, '', href);
	};
	const form = <>
		<form className={styles.historyControls} onSubmit={event => {
			event.preventDefault();
			const ledger = ledgerInput.trim();
			if (!validLedgerSequence(ledger)) {
				setInputError(true);
				return;
			}
			setInputError(false);
			navigate(ledger);
		}}>
			<label>
				Ledger number
				<input inputMode="numeric" maxLength={10} value={ledgerInput}
					aria-invalid={inputError || undefined} aria-describedby={inputError ? 'history-ledger-error' : undefined}
					onChange={event => { setLedgerInput(event.currentTarget.value); setInputError(false); }} />
			</label>
			<button type="submit">Browse ledger</button>
			{selection.mode !== 'recent' && <button type="button" onClick={() => navigate(null)}>Latest transactions</button>}
		</form>
		{inputError && <p className="explorer-state warning" id="history-ledger-error" role="alert">Enter a ledger number from 1 to 4,294,967,295.</p>}
	</>;
	if (selection.mode === 'recent') return (
		<details className={`explorer-panel ${styles.finder}`}>
			<summary>Browse by ledger</summary>
			{form}
		</details>
	);
	return (
		<section className="explorer-panel" aria-label="Transaction history by ledger">
			{form}
			{selection.mode === 'invalid' && <p className="explorer-state warning" role="alert">Invalid ledger or page in this link. Choose a ledger or return to latest transactions.</p>}
			{active && <>
				<div className={styles.historyControls} role="group" aria-label="Adjacent ledgers">
					<button type="button" disabled={active.ledger === '1'} onClick={() => navigate(String(Number(active.ledger) - 1))}>← Previous ledger</button>
					<button type="button" disabled={active.ledger === '4294967295'} onClick={() => navigate(String(Number(active.ledger) + 1))}>Next ledger →</button>
				</div>
				<LedgerTransactions key={active.ledger + ':' + active.offset} ledger={active.ledger} offset={active.offset}
					detailReturnTo={'/explorer' + (search ? '?' + search : '')}
					resultFilter={result}
					headingRef={focusPageHeading}
					onPage={offset => {
						if (offset === active.offset) return;
						paging.current = true;
						navigate(active.ledger, offset);
					}} />
			</>}
		</section>
	);
}
