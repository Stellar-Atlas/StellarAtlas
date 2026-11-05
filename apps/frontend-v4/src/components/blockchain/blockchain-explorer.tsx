'use client';
import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { getExplorerRecentTransactions } from '../../app/actions/network-data';
import { RecentTransactionsView } from './blockchain-explorer-results';
import { initialExplorerTransactions } from './blockchain-explorer-state';
import { useExplorerRequest } from './use-explorer-request';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import { ExplorerSearchForm } from './explorer-search-form';
import { ExplorerTransactionHistory } from './explorer-transaction-history';
import { readTransactionHistory } from './transaction-history-route';
import { readTransactionPageResult, type TransactionPageResult } from './transaction-page-result';
import styles from './explorer-transaction-table.module.css';

export function BlockchainExplorer(): React.JSX.Element {
	const params = useSearchParams();
	const search = params.get('search');
	const history = readTransactionHistory(params);
	const result = readTransactionPageResult(params);
	return (
		<section className="blockchain-explorer-workspace">
			<ExplorerEntityNavigation active="transactions" />
			<details key={search ?? ''} open={search ? true : undefined} className={`explorer-panel ${styles.finder}`}>
				<summary>Find by hash, address, ledger or asset</summary>
				<ExplorerSearchForm />
			</details>
			<ExplorerTransactionHistory key={history.mode === 'ledger' ? history.ledger : history.mode} selection={history} search={params.toString()} result={result} />
			{history.mode === 'recent' && <RecentTransactions result={result} />}
		</section>
	);
}

function RecentTransactions({ result }: { readonly result: TransactionPageResult }): React.JSX.Element {
	const feed = useExplorerRequest(
		initialExplorerTransactions,
		'Could not load transactions.'
	);
	const refresh = useCallback(
		() => feed.run(() => getExplorerRecentTransactions(20)),
		[feed.run]
	);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	const transactions = feed.result.transactions;
	const hasRows = Boolean(transactions?.records.length);
	return (
			<section
				className="explorer-panel explorer-feed-panel"
				aria-label="Browse transactions"
				aria-busy={feed.loading}
			>
				<div className="panel-heading explorer-feed-heading">
					<div>
						<h2>Recent transactions</h2>
					</div>
					<button disabled={feed.loading} onClick={() => void refresh()}>
						Refresh
					</button>
				</div>
				{feed.error ? (
					<div className="explorer-state warning explorer-request-notice" role="alert">
						<span>{feed.error}{hasRows ? ' Showing last loaded transactions.' : ''}</span>
						<button className="inspect-action" type="button" onClick={() => void refresh()}>Try again</button>
					</div>
				) : (feed.loading || !transactions) && (
					<p className="explorer-state neutral" role="status">
						{hasRows ? 'Refreshing transactions. Last loaded transactions remain visible.' : 'Loading recent transactions…'}
					</p>
				)}
				{transactions && ((!feed.error && !feed.loading) || hasRows) && <RecentTransactionsView transactions={transactions} result={result} />}
			</section>
	);
}
