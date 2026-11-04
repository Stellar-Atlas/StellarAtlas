'use client';
import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { getExplorerRecentTransactions } from '../../app/actions/network-data';
import { RecentTransactionsView } from './blockchain-explorer-results';
import { initialExplorerTransactions } from './blockchain-explorer-state';
import { useExplorerRequest } from './use-explorer-request';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import { ExplorerSearchForm } from './explorer-search-form';
import styles from './explorer-transaction-table.module.css';

export function BlockchainExplorer(): React.JSX.Element {
	const search = useSearchParams().get('search');
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
		<section className="blockchain-explorer-workspace">
			<ExplorerEntityNavigation active="transactions" />
			<details key={search ?? ''} open={search ? true : undefined} className={`explorer-panel ${styles.finder}`}>
				<summary>Find by hash, address, ledger or asset</summary>
				<ExplorerSearchForm />
			</details>
			<section
				className="explorer-panel explorer-feed-panel"
				aria-label="Browse transactions"
				aria-busy={feed.loading}
			>
				<div className="panel-heading explorer-feed-heading">
					<div>
						<h2>Recent transactions</h2>
						<span>
							Open a record to inspect its operations, events and related
							accounts.
						</span>
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
				{transactions && ((!feed.error && !feed.loading) || hasRows) && <RecentTransactionsView transactions={transactions} />}
			</section>
		</section>
	);
}
